package routes

import (
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
		registerCustomPublicRoutes(public, h)
	}
}
