package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
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

type usageImageStorageStub struct {
	exists      bool
	existsErr   error
	presignURL  string
	presignErr  error
	data        []byte
	contentType string
	fetchErr    error
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

func (s *usageImageLinkStoreStub) ListExpired(context.Context, time.Time, int) ([]*service.UsageLogImageLink, error) {
	return nil, nil
}

func (s *usageImageLinkStoreStub) DeleteByTokens(context.Context, []string) (int64, error) {
	return 0, nil
}

func (s *usageImageLinkStoreStub) MarkDisplayed(context.Context, int64, int64, string, time.Time) error {
	return nil
}

func (s *usageImageLinkStoreStub) MarkGenerationDuration(context.Context, int64, int64, string, int) error {
	return nil
}

func (s *usageImageStorageStub) ImageObjectExists(context.Context, string) (bool, error) {
	return s.exists, s.existsErr
}

func (s *usageImageStorageStub) PresignImageObject(context.Context, string) (string, error) {
	return s.presignURL, s.presignErr
}

func (s *usageImageStorageStub) FetchImageURL(context.Context, string) ([]byte, string, error) {
	return s.data, s.contentType, s.fetchErr
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

func TestUsageHandlerImageLinkStreamsInlineDataURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(nil, nil, nil, nil)
	handler.SetImageLinkDeps(&usageImageLinkStoreStub{link: &service.UsageLogImageLink{
		UserID:   7,
		ImageURL: "data:image/png;base64,YWJj",
	}}, nil)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})
		c.Next()
	})
	router.GET("/usage/image-links/:token", handler.ImageLink)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/usage/image-links/token", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
	require.Equal(t, []byte("abc"), recorder.Body.Bytes())
}

func TestUsageHandlerReportImageDisplayMarksUsageLink(t *testing.T) {
	gin.SetMode(gin.TestMode)
	taskStore := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_display": {
			ID:        "imgtask_display",
			UserID:    7,
			APIKeyID:  9,
			StartedAt: 100,
			CompletedAt: func() *int64 {
				value := int64(171)
				return &value
			}(),
			Execution: &service.ImageTaskExecution{
				UsageRequestID: "client:req-display",
			},
		},
	}}
	taskService := service.NewImageTaskServiceWithOptions(taskStore, time.Hour, time.Minute)
	linkStore := &asyncImageLinkStore{}
	handler := NewUsageHandler(nil, nil, nil, nil)
	handler.SetImageLinkDeps(linkStore, nil)
	handler.SetImageTaskService(taskService)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})
		c.Next()
	})
	router.POST("/usage/image-display", handler.ReportImageDisplay)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodPost,
		"/usage/image-display",
		strings.NewReader(`{"task_id":"imgtask_display","duration_ms":71000}`),
	))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, int64(7), linkStore.displayedUserID)
	require.Equal(t, int64(9), linkStore.displayedAPIKeyID)
	require.Equal(t, "client:req-display", linkStore.displayedRequest)
	require.False(t, linkStore.displayedAt.IsZero())
	require.Equal(t, 71000, linkStore.generationDurationMs)
}

func TestUsageHandlerImageLinkStreamsOwnedObject(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(nil, nil, nil, nil)
	handler.SetImageLinkDeps(
		&usageImageLinkStoreStub{link: &service.UsageLogImageLink{
			UserID:    7,
			ObjectKey: "images/result.png",
		}},
		&usageImageStorageStub{
			exists:      true,
			presignURL:  "https://storage.example.test/result.png",
			data:        []byte("image-bytes"),
			contentType: "image/png",
		},
	)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})
		c.Next()
	})
	router.GET("/usage/image-links/:token", handler.ImageLink)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/usage/image-links/token", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
	require.Equal(t, "private, max-age=300", recorder.Header().Get("Cache-Control"))
	require.Equal(t, "image-bytes", recorder.Body.String())
	require.Empty(t, recorder.Header().Get("Location"))
}

func TestUsageHandlerOpenImageLinkRedirectsObjectToPresignedURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(nil, nil, nil, nil)
	handler.SetImageLinkDeps(
		&usageImageLinkStoreStub{link: &service.UsageLogImageLink{
			UserID:    7,
			ObjectKey: "images/result.png",
		}},
		&usageImageStorageStub{
			presignURL: "https://storage.example.test/result.png",
		},
	)
	router := gin.New()
	router.GET("/usage-images/:token", handler.OpenImageLink)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/usage-images/token", nil))

	require.Equal(t, http.StatusFound, recorder.Code)
	require.Equal(t, "https://storage.example.test/result.png", recorder.Header().Get("Location"))
}

func TestUsageHandlerOpenImageLinkServesStoredPreviewBeforeOriginal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(nil, nil, nil, nil)
	handler.SetImageLinkDeps(
		&usageImageLinkStoreStub{link: &service.UsageLogImageLink{
			UserID:    7,
			ObjectKey: "images/result.png",
			ImageURL:  "data:image/jpeg;base64,cHJldmlldw==",
		}},
		&usageImageStorageStub{
			presignURL: "https://storage.example.test/result.png",
		},
	)
	router := gin.New()
	router.GET("/usage-images/:token", handler.OpenImageLink)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/usage-images/token", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "image/jpeg", recorder.Header().Get("Content-Type"))
	require.Equal(t, "preview", recorder.Body.String())
	require.Empty(t, recorder.Header().Get("Location"))

	originalRecorder := httptest.NewRecorder()
	router.ServeHTTP(originalRecorder, httptest.NewRequest(http.MethodGet, "/usage-images/token?full=1", nil))
	require.Equal(t, http.StatusFound, originalRecorder.Code)
	require.Equal(t, "https://storage.example.test/result.png", originalRecorder.Header().Get("Location"))
}

func TestUsageHandlerImageLinkAllowsAdminToOpenAnotherUsersImage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(nil, nil, nil, nil)
	handler.SetImageLinkDeps(
		&usageImageLinkStoreStub{link: &service.UsageLogImageLink{
			UserID:    7,
			ObjectKey: "images/result.png",
		}},
		&usageImageStorageStub{
			exists:      true,
			presignURL:  "https://storage.example.test/result.png",
			data:        []byte("admin-visible-image"),
			contentType: "image/png",
		},
	)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 1})
		c.Set(string(middleware2.ContextKeyUserRole), service.RoleAdmin)
		c.Next()
	})
	router.GET("/usage/image-links/:token", handler.ImageLink)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/usage/image-links/token", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
	require.Equal(t, "admin-visible-image", recorder.Body.String())
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
