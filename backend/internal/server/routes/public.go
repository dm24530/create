package routes

import (
	"os"
	"path/filepath"

	"github.com/Wei-Shaw/sub2api/internal/handler"

	"github.com/gin-gonic/gin"
)

// RegisterPublicRoutes registers unauthenticated read-only public API routes.
func RegisterPublicRoutes(v1 *gin.RouterGroup, h *handler.Handlers) {
	public := v1.Group("/public")
	{
		if h.AsyncImage != nil {
			public.GET("/image-task-previews/:task_id/:index", h.AsyncImage.PreviewContent)
			public.GET("/image-task-media/:task_id/:index", h.AsyncImage.MediaContent)
		}
		if h.ImageStudioGallery != nil {
			public.GET("/studio-works/:id/:variant", h.ImageStudioGallery.PublicContent)
		}
		if h.VideoStudioGallery != nil {
			public.GET("/video-works/:id/content", h.VideoStudioGallery.PublicContent)
			public.GET("/video-reference-assets/:token", h.VideoStudioGallery.PublicReferenceContent)
		}
		if h.LocalImageAsset != nil {
			public.GET("/image-assets/:asset_id", h.LocalImageAsset.Serve)
			public.HEAD("/image-assets/:asset_id", h.LocalImageAsset.Serve)
		}
		if h.Canvas != nil {
			public.GET("/canvas-assets/:asset_id/:variant", h.Canvas.PublicAssetContent)
		}
		localClientDir := os.Getenv("LOCAL_CLIENT_RELEASE_DIR")
		if localClientDir == "" {
			localClientDir = filepath.Join("data", "local-client")
		}
		public.GET("/local-client/latest.json", serveLocalClientReleaseFile(localClientDir, "latest.json", "application/json; charset=utf-8"))
		public.GET("/local-client/create-local.exe", serveLocalClientReleaseFile(localClientDir, "create-local.exe", "application/octet-stream"))
		public.GET("/local-client/create-local.exe.sha256", serveLocalClientReleaseFile(localClientDir, "create-local.exe.sha256", "text/plain; charset=utf-8"))
		registerCustomPublicRoutes(public, h)
	}
}

func serveLocalClientReleaseFile(directory, filename, contentType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		allowed := map[string]struct{}{
			"latest.json":             {},
			"create-local.exe":        {},
			"create-local.exe.sha256": {},
		}
		if _, ok := allowed[filename]; !ok {
			c.Status(404)
			return
		}
		target := filepath.Join(directory, filename)
		if _, err := os.Stat(target); err != nil {
			c.Status(404)
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.Header("Content-Type", contentType)
		c.File(target)
	}
}
