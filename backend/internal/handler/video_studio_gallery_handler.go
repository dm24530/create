package handler

import (
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type VideoStudioGalleryHandler struct {
	gallery *service.VideoStudioGalleryService
}

func NewVideoStudioGalleryHandler(gallery *service.VideoStudioGalleryService) *VideoStudioGalleryHandler {
	return &VideoStudioGalleryHandler{gallery: gallery}
}

type saveVideoStudioGalleryRequest struct {
	// 二选一：video_url 交给服务端抓取（Seedance 这类公开直链），
	// video_data_url 由前端上传（Grok 的内容接口需要密钥，浏览器已经拿到字节）。
	VideoURL        string `json:"video_url"`
	VideoDataURL    string `json:"video_data_url"`
	Prompt          string `json:"prompt"`
	Model           string `json:"model"`
	Format          string `json:"format"`
	DurationSeconds int    `json:"duration_seconds"`
	CreatedAt       int64  `json:"created_at"`
	SortOrder       int64  `json:"sort_order"`
	// Saved 为真表示直接存进「我的作品」（长期有效、计入配额）；
	// 不传时保持老行为（true）。
	Saved *bool `json:"saved"`
}

type uploadVideoReferenceAssetRequest struct {
	Kind    string `json:"kind"`
	DataURL string `json:"data_url"`
}

func (h *VideoStudioGalleryHandler) UploadReferenceAsset(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	var request uploadVideoReferenceAssetRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "Invalid reference asset request")
		return
	}

	var (
		data        []byte
		contentType string
		err         error
	)
	switch strings.ToLower(strings.TrimSpace(request.Kind)) {
	case "image":
		data, contentType, err = decodeImageStudioDataURL(request.DataURL)
	case "video":
		data, contentType, err = service.DecodeVideoDataURL(request.DataURL)
	case "audio":
		data, contentType, err = service.DecodeAudioDataURL(request.DataURL)
	default:
		response.BadRequest(c, "kind must be image, video, or audio")
		return
	}
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}

	url, err := h.gallery.UploadReferenceAsset(
		c.Request.Context(),
		subject.UserID,
		request.Kind,
		contentType,
		data,
	)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{"url": url})
}

func (h *VideoStudioGalleryHandler) Save(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	var request saveVideoStudioGalleryRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "Invalid gallery request")
		return
	}

	ctx := c.Request.Context()
	videoURL := strings.TrimSpace(request.VideoURL)
	dataURL := strings.TrimSpace(request.VideoDataURL)
	saved := request.Saved == nil || *request.Saved

	var entry *service.VideoStudioGalleryEntry
	var err error
	switch {
	case dataURL != "":
		var data []byte
		var contentType string
		data, contentType, err = service.DecodeVideoDataURL(dataURL)
		if err != nil {
			response.ErrorFrom(c, err)
			return
		}
		entry, err = h.gallery.Save(
			ctx, subject.UserID, request.Prompt, request.Model, request.Format, request.DurationSeconds, contentType, data, saved,
			service.VideoStudioGallerySaveOptions{
				CreatedAt: request.CreatedAt,
				SortOrder: request.SortOrder,
			},
		)
	case videoURL != "":
		entry, err = h.gallery.SaveFromURL(
			ctx, subject.UserID, request.Prompt, request.Model, request.Format, request.DurationSeconds, videoURL, saved,
			service.VideoStudioGallerySaveOptions{
				CreatedAt: request.CreatedAt,
				SortOrder: request.SortOrder,
			},
		)
	default:
		response.BadRequest(c, "video_url or video_data_url is required")
		return
	}
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, entry)
}

func (h *VideoStudioGalleryHandler) List(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	// 0 = 条数由后台配额决定，和图片图库保持一致。
	entries, err := h.gallery.List(c.Request.Context(), subject.UserID, 0, studioWorksScopeSaved(c))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, entries)
}

// Pin 把一条临时视频存进「我的作品」（长期有效、计入配额）。
func (h *VideoStudioGalleryHandler) Pin(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	if err := h.gallery.Pin(c.Request.Context(), subject.UserID, strings.TrimSpace(c.Param("id"))); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{"saved": true})
}

// Unpin 取消保存；作品按临时保留期已过期时返回 409，由前端确认后删除。
func (h *VideoStudioGalleryHandler) Unpin(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	entry, err := h.gallery.Unpin(c.Request.Context(), subject.UserID, strings.TrimSpace(c.Param("id")))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{
		"saved":      false,
		"expires_at": entry.ExpiresAt,
	})
}

func (h *VideoStudioGalleryHandler) Delete(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	if err := h.gallery.Delete(c.Request.Context(), subject.UserID, c.Param("id")); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{"deleted": true})
}
