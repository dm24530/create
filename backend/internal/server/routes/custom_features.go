package routes

import (
	"github.com/Wei-Shaw/sub2api/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerCustomAdminRoutes(admin *gin.RouterGroup, h *handler.Handlers) {
	registerCustomLotteryRoutes(admin, h)
}

func registerCustomLotteryRoutes(admin *gin.RouterGroup, h *handler.Handlers) {
	lotteries := admin.Group("/lotteries")
	{
		lotteries.GET("", h.Admin.Lottery.List)
		lotteries.GET("/:id", h.Admin.Lottery.GetByID)
		lotteries.POST("", h.Admin.Lottery.Create)
		lotteries.PUT("/:id", h.Admin.Lottery.Update)
		lotteries.DELETE("/:id", h.Admin.Lottery.Delete)
		lotteries.POST("/:id/draw", h.Admin.Lottery.Draw)
	}
}

func registerCustomAdminSettingsRoutes(adminSettings *gin.RouterGroup, h *handler.Handlers) {
	adminSettings.GET("/upstream-monitor", h.Admin.Setting.GetUpstreamMonitorConfig)
	adminSettings.PUT("/upstream-monitor", h.Admin.Setting.UpdateUpstreamMonitorConfig)
	adminSettings.POST("/upstream-monitor/preview", h.Admin.Setting.PreviewUpstreamMonitorConfig)
	adminSettings.POST("/upstream-monitor/refresh", h.Admin.Setting.RefreshUpstreamMonitorConfig)
}

func registerCustomUserRoutes(authenticated *gin.RouterGroup, h *handler.Handlers) {
	lotteries := authenticated.Group("/lotteries")
	{
		lotteries.GET("", h.Lottery.List)
		lotteries.POST("/:id/join", h.Lottery.Join)
	}
}

func registerCustomPublicRoutes(public *gin.RouterGroup, h *handler.Handlers) {
	// 在线灵感的媒体代理：<img>/<video> 带不上 JWT，只能免登录，
	// 安全边界由服务里的主机白名单保证（不是通用代理）。
	inspiration := public.Group("/video-inspiration")
	{
		inspiration.GET("/media", h.VideoInspiration.Media)
	}
	public.GET("/models/available", h.AvailableChannel.ListPublicModels)
}
