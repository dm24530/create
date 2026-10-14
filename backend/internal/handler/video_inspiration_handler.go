package handler

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// VideoInspirationHandler 在服务端拉取在线灵感，并代理媒体回源。
type VideoInspirationHandler struct {
	inspiration *service.VideoInspirationService
	library     *service.InspirationLibraryService
}

func NewVideoInspirationHandler(
	inspiration *service.VideoInspirationService,
	library *service.InspirationLibraryService,
) *VideoInspirationHandler {
	return &VideoInspirationHandler{inspiration: inspiration, library: library}
}

// Library 返回自家灵感站的作品库（视频提示词 / 图片灵感），支持模型、分类、关键词与分页。
func (h *VideoInspirationHandler) Library(c *gin.Context) {
	page, _ := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page", "1")))
	pageSize, _ := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page_size", "24")))
	result, err := h.library.Library(c.Request.Context(), service.InspirationLibraryQuery{
		Type:     c.Query("type"),
		Model:    c.Query("model"),
		Category: c.Query("category"),
		Keyword:  c.Query("q"),
		Page:     page,
		PageSize: pageSize,
		Refresh:  strings.TrimSpace(c.Query("refresh")) == "1",
	})
	if err != nil {
		response.ErrorFrom(c, infraerrors.New(
			http.StatusBadGateway,
			"VIDEO_INSPIRATION_LIBRARY_UNAVAILABLE",
			"inspiration library is unreachable: "+err.Error(),
		))
		return
	}
	response.Success(c, result)
}

func (h *VideoInspirationHandler) Online(c *gin.Context) {
	limit, _ := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("limit", "24")))
	// refresh=1 绕过缓存：后台的「换一批」要真的能换到新内容。
	feed, err := h.inspiration.Online(c.Request.Context(), service.InspirationQuery{
		MediaType: c.Query("type"),
		Sort:      c.Query("sort"),
		Period:    c.Query("period"),
		Limit:     limit,
		Refresh:   strings.TrimSpace(c.Query("refresh")) == "1",
	})
	if err != nil {
		response.ErrorFrom(c, infraerrors.New(
			http.StatusBadGateway,
			"VIDEO_INSPIRATION_UNAVAILABLE",
			"online inspiration source is unreachable: "+err.Error(),
		))
		return
	}
	if feed.Items == nil {
		feed.Items = []service.OnlineInspirationItem{}
	}
	response.Success(c, feed)
}

// Media 代理第三方素材（视频/封面）。
//
// 这个接口必须免登录：<img>/<video> 发出的请求带不上 JWT。安全边界靠主机白名单，
// 它不是通用代理，只能回源到灵感源的 CDN。
func (h *VideoInspirationHandler) Media(c *gin.Context) {
	// 配了对象存储就先把图片转存到自己的桶里，之后直接重定向过去：
	// 素材不再依赖上游可用性，也不再经过这台服务器。
	if target, ok := h.inspiration.MirrorToStorage(c.Request.Context(), c.Query("u")); ok {
		c.Redirect(http.StatusFound, target)
		return
	}
	resp, err := h.inspiration.FetchMedia(c.Request.Context(), c.Query("u"), c.GetHeader("Range"))
	if err != nil {
		response.ErrorFrom(c, infraerrors.New(
			http.StatusBadGateway,
			"VIDEO_INSPIRATION_MEDIA_UNAVAILABLE",
			"inspiration media is unavailable: "+err.Error(),
		))
		return
	}
	defer func() { _ = resp.Body.Close() }()

	for _, header := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if value := resp.Header.Get(header); value != "" {
			c.Header(header, value)
		}
	}
	c.Header("Cache-Control", "public, max-age=3600")
	c.Status(resp.StatusCode)
	if _, err := io.Copy(c.Writer, resp.Body); err != nil {
		_ = c.Error(err)
	}
}
