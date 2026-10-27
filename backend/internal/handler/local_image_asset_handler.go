package handler

import (
	"bytes"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type LocalImageAssetHandler struct {
	assets  *service.LocalImageAssetStore
	storage *service.ImageStorageSettingService
}

func NewLocalImageAssetHandler(
	assets *service.LocalImageAssetStore,
	storage *service.ImageStorageSettingService,
) *LocalImageAssetHandler {
	return &LocalImageAssetHandler{assets: assets, storage: storage}
}

// Serve keeps generated images available immediately after generation. Pending
// files stream from local disk; uploaded files redirect to the object store, or
// stream back through the server when the browser requested a download.
func (h *LocalImageAssetHandler) Serve(c *gin.Context) {
	if h == nil || h.assets == nil {
		http.NotFound(c.Writer, c.Request)
		return
	}
	assetID := strings.TrimSpace(c.Param("asset_id"))
	meta, err := h.assets.Get(assetID)
	if err != nil {
		if errors.Is(err, service.ErrLocalImageAssetNotFound) {
			http.NotFound(c.Writer, c.Request)
			return
		}
		http.Error(c.Writer, "image asset unavailable", http.StatusInternalServerError)
		return
	}
	if meta.ExpiresAt > 0 && time.Now().UTC().Unix() >= meta.ExpiresAt {
		deleteErr := h.assets.Delete(assetID)
		if h.storage != nil && strings.TrimSpace(meta.ObjectKey) != "" {
			_ = h.storage.DeleteObject(c.Request.Context(), meta.ObjectKey)
			deleteErr = nil
		}
		if deleteErr != nil &&
			!errors.Is(deleteErr, service.ErrLocalImageAssetNotFound) {
			http.Error(c.Writer, "image asset cleanup failed", http.StatusInternalServerError)
			return
		}
		http.NotFound(c.Writer, c.Request)
		return
	}

	download := localAssetDownloadRequested(c)
	if meta.Uploaded {
		if download {
			h.serveUploadedDownload(c, assetID)
			return
		}
		target := h.uploadedAssetURL(c, meta)
		if target != "" {
			c.Header("Cache-Control", "private, max-age=60")
			c.Redirect(http.StatusFound, target)
			return
		}
	}

	meta, file, err := h.assets.Open(assetID)
	if err != nil {
		if errors.Is(err, service.ErrLocalImageAssetNotFound) {
			latest, latestErr := h.assets.Get(assetID)
			if latestErr == nil && latest.Uploaded {
				if target := h.uploadedAssetURL(c, latest); target != "" {
					c.Header("Cache-Control", "private, max-age=60")
					c.Redirect(http.StatusFound, target)
					return
				}
			}
			http.NotFound(c.Writer, c.Request)
			return
		}
		http.Error(c.Writer, "image asset unavailable", http.StatusInternalServerError)
		return
	}
	defer func() { _ = file.Close() }()

	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("Content-Type", meta.ContentType)
	c.Header("Accept-Ranges", "bytes")
	if download {
		c.Header("Content-Disposition", localAssetContentDisposition(meta))
	}
	http.ServeContent(c.Writer, c.Request, meta.FileName, time.Unix(meta.CreatedAt, 0), file)
}

func (h *LocalImageAssetHandler) uploadedAssetURL(
	c *gin.Context,
	meta *service.LocalImageAssetMetadata,
) string {
	if h.storage != nil && strings.TrimSpace(meta.ObjectKey) != "" {
		if target, err := h.storage.PresignImageObject(c.Request.Context(), meta.ObjectKey); err == nil {
			return strings.TrimSpace(target)
		}
	}
	return strings.TrimSpace(meta.RemoteURL)
}

func (h *LocalImageAssetHandler) serveUploadedDownload(c *gin.Context, assetID string) {
	if h.storage != nil {
		data, contentType, err := h.storage.FetchImageURL(
			c.Request.Context(),
			h.assets.URL(assetID),
		)
		if err == nil && len(data) > 0 {
			meta, metaErr := h.assets.Get(assetID)
			if metaErr != nil {
				http.NotFound(c.Writer, c.Request)
				return
			}
			if strings.TrimSpace(contentType) == "" {
				contentType = meta.ContentType
			}
			c.Header("Cache-Control", "private, max-age=3600")
			c.Header("Content-Type", contentType)
			c.Header("Content-Disposition", localAssetContentDisposition(meta))
			http.ServeContent(
				c.Writer,
				c.Request,
				meta.FileName,
				time.Unix(meta.CreatedAt, 0),
				bytes.NewReader(data),
			)
			return
		}
	}

	meta, file, err := h.assets.Open(assetID)
	if err != nil {
		http.Error(c.Writer, "image asset unavailable", http.StatusBadGateway)
		return
	}
	defer func() { _ = file.Close() }()
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("Content-Type", meta.ContentType)
	c.Header("Content-Disposition", localAssetContentDisposition(meta))
	http.ServeContent(c.Writer, c.Request, meta.FileName, time.Unix(meta.CreatedAt, 0), file)
}

func localAssetDownloadRequested(c *gin.Context) bool {
	if c == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(c.Query("download"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func localAssetContentDisposition(meta *service.LocalImageAssetMetadata) string {
	extension := ".png"
	switch {
	case strings.Contains(meta.ContentType, "jpeg"), strings.Contains(meta.ContentType, "jpg"):
		extension = ".jpg"
	case strings.Contains(meta.ContentType, "webp"):
		extension = ".webp"
	case strings.Contains(meta.ContentType, "gif"):
		extension = ".gif"
	}
	return `attachment; filename="image-` + meta.ID + extension + `"`
}
