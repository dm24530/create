package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

const maxImageStudioGalleryBytes = 32 << 20

type ImageStudioGalleryHandler struct {
	gallery    *service.ImageStudioGalleryService
	tasks      *service.ImageTaskService
	imageLinks service.UsageLogImageLinkStore
}

type saveImageStudioGalleryRequest struct {
	ImageDataURL string `json:"image_data_url"`
	ImageURL     string `json:"image_url"`
	Prompt       string `json:"prompt"`
	Model        string `json:"model"`
	Size         string `json:"size"`
	Format       string `json:"format"`
	DurationMs   int    `json:"duration_ms"`
	CreatedAt    int64  `json:"created_at"`
	SortOrder    int64  `json:"sort_order"`
	// Saved 为真表示直接存进「我的作品」（长期有效、计入配额）；
	// 不传时保持老行为（true），显式传 false 才是"只是生成页的临时内容"。
	Saved *bool `json:"saved"`
}

type saveImageStudioGalleryFromTaskRequest struct {
	TaskID     string `json:"task_id"`
	ImageIndex int    `json:"image_index"`
	Prompt     string `json:"prompt"`
	Model      string `json:"model"`
	Size       string `json:"size"`
	Format     string `json:"format"`
	DurationMs int    `json:"duration_ms"`
	CreatedAt  int64  `json:"created_at"`
	SortOrder  int64  `json:"sort_order"`
	Saved      *bool  `json:"saved"`
}

func NewImageStudioGalleryHandler(
	gallery *service.ImageStudioGalleryService,
	tasks *service.ImageTaskService,
) *ImageStudioGalleryHandler {
	return &ImageStudioGalleryHandler{gallery: gallery, tasks: tasks}
}

func (h *ImageStudioGalleryHandler) SetImageLinkStore(store service.UsageLogImageLinkStore) {
	if h == nil {
		return
	}
	h.imageLinks = store
}

func (h *ImageStudioGalleryHandler) Save(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	var request saveImageStudioGalleryRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "Invalid gallery request")
		return
	}

	ctx := c.Request.Context()
	dataURL := strings.TrimSpace(request.ImageDataURL)
	imageURL := strings.TrimSpace(request.ImageURL)
	saved := request.Saved == nil || *request.Saved

	var entry *service.ImageStudioGalleryEntry
	var err error
	switch {
	case dataURL != "":
		var data []byte
		var contentType string
		data, contentType, err = decodeImageStudioDataURL(dataURL)
		if err != nil {
			response.BadRequest(c, err.Error())
			return
		}
		entry, err = h.gallery.Save(
			ctx, subject.UserID, request.Prompt, request.Model, request.Size, request.Format, contentType, data, saved,
			service.ImageStudioGallerySaveOptions{
				DurationMs: request.DurationMs,
				CreatedAt:  request.CreatedAt,
				SortOrder:  request.SortOrder,
			},
		)
	case imageURL != "":
		entry, err = h.gallery.SaveFromURL(
			ctx, subject.UserID, request.Prompt, request.Model, request.Size, request.Format, imageURL, saved,
			service.ImageStudioGallerySaveOptions{
				DurationMs: request.DurationMs,
				CreatedAt:  request.CreatedAt,
				SortOrder:  request.SortOrder,
			},
		)
	default:
		response.BadRequest(c, "image_data_url or image_url is required")
		return
	}
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, entry)
}

func (h *ImageStudioGalleryHandler) SaveFromTask(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	if h == nil || h.tasks == nil || h.gallery == nil {
		response.ErrorFrom(c, service.ErrImageStudioGalleryUnavailable)
		return
	}
	var request saveImageStudioGalleryFromTaskRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "Invalid gallery task request")
		return
	}
	record, err := h.tasks.GetRecord(c.Request.Context(), strings.TrimSpace(request.TaskID))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	if record == nil || record.UserID != subject.UserID {
		response.NotFound(c, "Image task not found")
		return
	}
	if record.Status != service.ImageTaskStatusCompleted {
		response.Error(c, http.StatusConflict, "Image task is not ready to save")
		return
	}
	h.markImageGenerationDuration(c.Request.Context(), record, request.DurationMs)
	var payload struct {
		Data []struct {
			ObjectKey string `json:"object_key"`
			URL       string `json:"url"`
			MIMEType  string `json:"mime_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(record.Result, &payload); err != nil || len(payload.Data) == 0 {
		response.Error(c, http.StatusConflict, "Image task has no persisted image")
		return
	}
	index := request.ImageIndex
	if index < 0 {
		index = 0
	}
	if index >= len(payload.Data) {
		response.BadRequest(c, "Image index is out of range")
		return
	}
	item := payload.Data[index]
	if strings.TrimSpace(item.ObjectKey) == "" {
		response.Error(c, http.StatusConflict, "Image task has no persisted object key")
		return
	}
	saved := request.Saved == nil || *request.Saved
	entry, err := h.gallery.SaveExistingObject(
		c.Request.Context(),
		subject.UserID,
		item.ObjectKey,
		item.URL,
		request.Prompt,
		request.Model,
		request.Size,
		request.Format,
		saved,
		service.ImageStudioGallerySaveOptions{
			DurationMs:  request.DurationMs,
			CreatedAt:   request.CreatedAt,
			SortOrder:   request.SortOrder,
			ContentType: item.MIMEType,
		},
	)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, entry)
}

func (h *ImageStudioGalleryHandler) markImageGenerationDuration(
	ctx context.Context,
	record *service.ImageTaskRecord,
	requestedDurationMs int,
) {
	if h == nil || h.imageLinks == nil || record == nil || record.Execution == nil {
		return
	}
	requestID := strings.TrimSpace(record.Execution.UsageRequestID)
	if requestID == "" {
		return
	}
	durationMs := max(requestedDurationMs, 0)
	if durationMs == 0 && record.CompletedAt != nil && record.StartedAt > 0 {
		durationMs = int(max(*record.CompletedAt-record.StartedAt, 0) * 1000)
	}
	if durationMs == 0 && record.CompletedAt != nil && record.CreatedAt > 0 {
		durationMs = int(max(*record.CompletedAt-record.CreatedAt, 0) * 1000)
	}
	if err := h.imageLinks.MarkGenerationDuration(
		ctx,
		record.UserID,
		record.APIKeyID,
		requestID,
		durationMs,
	); err != nil {
		return
	}
}

func (h *ImageStudioGalleryHandler) List(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	c.Header("Cache-Control", "no-store")
	// 0 = 条数由后台配额决定（配额调大后不能还只给 100 条，否则更早的作品看不到也删不掉）。
	items, err := h.gallery.List(c.Request.Context(), subject.UserID, 0, studioWorksScopeSaved(c))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, items)
}

// Download streams one owned image as an attachment. Fetching through the
// server avoids the browser's cross-origin download restriction.
func (h *ImageStudioGalleryHandler) Download(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	entry, data, contentType, err := h.gallery.ReadImage(
		c.Request.Context(),
		subject.UserID,
		strings.TrimSpace(c.Param("id")),
	)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	filename := imageStudioDownloadFilename(entry)
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(http.StatusOK, contentType, data)
}

func (h *ImageStudioGalleryHandler) DownloadURL(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	entry, err := h.gallery.Get(c.Request.Context(), subject.UserID, projectID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	filename := imageStudioDownloadFilename(entry)
	_, url, err := h.gallery.DownloadURL(c.Request.Context(), subject.UserID, projectID, filename)
	if err != nil || strings.TrimSpace(url) == "" {
		response.Error(c, http.StatusServiceUnavailable, "直接下载地址暂时不可用")
		return
	}
	response.Success(c, gin.H{"url": url, "filename": filename})
}

func imageStudioDownloadFilename(entry *service.ImageStudioGalleryEntry) string {
	ext := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(path.Ext(entry.ObjectKey))), ".")
	if ext == "" {
		ext = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(entry.Format)), ".")
	}
	ext = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, ext)
	if len(ext) > 8 {
		ext = ext[:8]
	}
	if ext == "" {
		ext = "png"
	}
	return `image-` + entry.ID + `.` + ext
}

// Thumbnail returns a cached small JPEG preview for list views. Loading the
// original image in every card is the main reason the works page feels slow.
func (h *ImageStudioGalleryHandler) Thumbnail(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	data, err := h.gallery.Thumbnail(
		c.Request.Context(),
		subject.UserID,
		strings.TrimSpace(c.Param("id")),
		720,
	)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	c.Header("Cache-Control", "private, max-age=86400")
	c.Data(http.StatusOK, "image/jpeg", data)
}

// studioWorksScopeSaved 把 ?scope=saved|temp 翻译成列表过滤条件。
// 不传（或传其它值）时不过滤：图片工作台要同屏展示临时内容和已保存的作品。
func studioWorksScopeSaved(c *gin.Context) *bool {
	switch strings.ToLower(strings.TrimSpace(c.Query("scope"))) {
	case "saved":
		saved := true
		return &saved
	case "temp":
		saved := false
		return &saved
	default:
		return nil
	}
}

// Pin 把一条临时作品存进「我的作品」（长期有效、计入配额）。
func (h *ImageStudioGalleryHandler) Pin(c *gin.Context) {
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

// Unpin 取消保存：未过期内容转为临时内容；过期内容返回 409，等待用户确认删除。
func (h *ImageStudioGalleryHandler) Unpin(c *gin.Context) {
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

// Delete 删除一条图片作品：记录和对象存储里的文件一起删。
func (h *ImageStudioGalleryHandler) Delete(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	if err := h.gallery.Delete(c.Request.Context(), subject.UserID, strings.TrimSpace(c.Param("id"))); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{"deleted": true})
}

// Quota 返回作品库的配额使用情况（图片 + 视频合并计算），供前端展示「已用 N / 上限」。
func (h *ImageStudioGalleryHandler) Quota(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not found in context")
		return
	}
	c.Header("Cache-Control", "no-store")
	quota, err := h.gallery.Quota(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, quota)
}

func decodeImageStudioDataURL(raw string) ([]byte, string, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(strings.ToLower(raw), "data:") {
		return nil, "", errors.New("image_data_url must be a data URL")
	}
	header, payload, ok := strings.Cut(raw[len("data:"):], ",")
	if !ok {
		return nil, "", errors.New("invalid image data URL")
	}
	parts := strings.Split(header, ";")
	if len(parts) < 2 || !strings.EqualFold(strings.TrimSpace(parts[len(parts)-1]), "base64") {
		return nil, "", errors.New("image data URL must be base64 encoded")
	}
	contentType, _, err := mime.ParseMediaType(strings.Join(parts[:len(parts)-1], ";"))
	if err != nil || !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		return nil, "", errors.New("image data URL must contain an image")
	}
	if len(payload) > base64.StdEncoding.EncodedLen(maxImageStudioGalleryBytes) {
		return nil, "", errors.New("image is too large")
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, "", errors.New("invalid base64 image")
	}
	if len(data) == 0 || len(data) > maxImageStudioGalleryBytes {
		return nil, "", errors.New("image is too large or empty")
	}
	detected := strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0])
	if strings.HasPrefix(detected, "image/") {
		contentType = detected
	}
	return data, contentType, nil
}
