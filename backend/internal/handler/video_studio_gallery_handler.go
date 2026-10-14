package handler

import (
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

const maxVideoStudioGalleryItems = 100

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
			ctx, subject.UserID, request.Prompt, request.Model, request.Format, request.DurationSeconds, contentType, data,
		)
	case videoURL != "":
		entry, err = h.gallery.SaveFromURL(
			ctx, subject.UserID, request.Prompt, request.Model, request.Format, request.DurationSeconds, videoURL,
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
	entries, err := h.gallery.List(c.Request.Context(), subject.UserID, maxVideoStudioGalleryItems)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, entries)
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
