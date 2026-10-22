package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type usageImageLinkStoreStub struct {
	link *service.UsageLogImageLink
	err  error
}

func (s *usageImageLinkStoreStub) Upsert(context.Context, *service.UsageLogImageLink) error {
	return nil
}

func (s *usageImageLinkStoreStub) GetByToken(context.Context, string) (*service.UsageLogImageLink, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.link, nil
}

func (s *usageImageLinkStoreStub) DeleteExpired(context.Context, time.Time, int) (int64, error) {
	return 0, nil
}

func TestUsageHandlerImageLinkRedirectsOwnedFallbackURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(nil, nil, nil, nil)
	handler.SetImageLinkDeps(&usageImageLinkStoreStub{link: &service.UsageLogImageLink{
		UserID:   7,
		ImageURL: "https://cdn.example.test/image.png",
	}}, nil)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})
		c.Next()
	})
	router.GET("/usage/image-links/:token", handler.ImageLink)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/usage/image-links/token", nil))

	require.Equal(t, http.StatusFound, recorder.Code)
	require.Equal(t, "https://cdn.example.test/image.png", recorder.Header().Get("Location"))
}

func TestUsageHandlerImageLinkHidesOtherUsersAndExpiredLinks(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name string
		link *service.UsageLogImageLink
		err  error
	}{
		{name: "other user", link: &service.UsageLogImageLink{UserID: 8, ImageURL: "https://cdn.example.test/image.png"}},
		{name: "missing", err: service.ErrUsageLogImageLinkNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler := NewUsageHandler(nil, nil, nil, nil)
			handler.SetImageLinkDeps(&usageImageLinkStoreStub{link: tc.link, err: tc.err}, nil)
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})
				c.Next()
			})
			router.GET("/usage/image-links/:token", handler.ImageLink)

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/usage/image-links/token", nil))
			require.Equal(t, http.StatusGone, recorder.Code)
			require.Contains(t, recorder.Body.String(), "图片已过期")
		})
	}
}
