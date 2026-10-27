package routes

import (
	"github.com/Wei-Shaw/sub2api/internal/handler"

	"github.com/gin-gonic/gin"
)

// RegisterPublicRoutes registers unauthenticated read-only public API routes.
func RegisterPublicRoutes(v1 *gin.RouterGroup, h *handler.Handlers) {
	public := v1.Group("/public")
	{
		if h.LocalImageAsset != nil {
			public.GET("/image-assets/:asset_id", h.LocalImageAsset.Serve)
			public.HEAD("/image-assets/:asset_id", h.LocalImageAsset.Serve)
		}
		registerCustomPublicRoutes(public, h)
	}
}
