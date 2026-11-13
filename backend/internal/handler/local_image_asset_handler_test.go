package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestLocalImageAssetHandlerServesRangeAndDownload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := service.NewLocalImageAssetStore(t.TempDir())
	payload := []byte("\x89PNG\r\n\x1a\nlocal-image-payload")
	meta, err := store.Save(
		context.Background(),
		42,
		"task-1",
		"images/users/42/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		payload,
	)
	require.NoError(t, err)
	handler := NewLocalImageAssetHandler(store, nil)
	router := gin.New()
	router.GET("/api/v1/public/image-assets/:asset_id", handler.Serve)
	router.HEAD("/api/v1/public/image-assets/:asset_id", handler.Serve)

	full := httptest.NewRecorder()
	router.ServeHTTP(full, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-assets/"+meta.ID,
		nil,
	))
	require.Equal(t, http.StatusOK, full.Code)
	require.Equal(t, "image/png", full.Header().Get("Content-Type"))
	require.Equal(t, payload, full.Body.Bytes())

	partial := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/image-assets/"+meta.ID, nil)
	request.Header.Set("Range", "bytes=0-7")
	router.ServeHTTP(partial, request)
	require.Equal(t, http.StatusPartialContent, partial.Code)
	require.Equal(t, payload[:8], partial.Body.Bytes())
	require.NotEmpty(t, partial.Header().Get("Content-Range"))

	head := httptest.NewRecorder()
	router.ServeHTTP(head, httptest.NewRequest(
		http.MethodHead,
		"/api/v1/public/image-assets/"+meta.ID,
		nil,
	))
	require.Equal(t, http.StatusOK, head.Code)
	require.Equal(t, strconv.Itoa(len(payload)), head.Header().Get("Content-Length"))

	download := httptest.NewRecorder()
	router.ServeHTTP(download, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-assets/"+meta.ID+"?download=1",
		nil,
	))
	require.Equal(t, http.StatusOK, download.Code)
	require.Contains(t, download.Header().Get("Content-Disposition"), "attachment")
	require.Equal(t, payload, download.Body.Bytes())
}

func TestLocalImageAssetHandlerRedirectsAfterRemoteUpload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := service.NewLocalImageAssetStore(t.TempDir())
	meta, err := store.Save(
		context.Background(),
		42,
		"task-1",
		"images/users/42/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		[]byte("\x89PNG\r\n\x1a\nremote-image-payload"),
	)
	require.NoError(t, err)
	require.NoError(t, store.MarkUploaded(meta.ID, "https://cdn.example.com/image.png"))

	handler := NewLocalImageAssetHandler(store, nil)
	router := gin.New()
	router.GET("/api/v1/public/image-assets/:asset_id", handler.Serve)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-assets/"+meta.ID,
		nil,
	))
	require.NotEqual(t, http.StatusFound, recorder.Code)
	require.Empty(t, recorder.Header().Get("Location"))
}

func TestLocalImageAssetHandlerRejectsExpiredAssetAndRemovesIt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := service.NewLocalImageAssetStore(t.TempDir())
	meta, err := store.Save(
		context.Background(),
		42,
		"task-expired",
		"images/users/42/task-expired-0.png",
		"image/png",
		time.Now().Add(-time.Minute).Unix(),
		[]byte("\x89PNG\r\n\x1a\nexpired-image-payload"),
	)
	require.NoError(t, err)

	handler := NewLocalImageAssetHandler(store, nil)
	router := gin.New()
	router.GET("/api/v1/public/image-assets/:asset_id", handler.Serve)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-assets/"+meta.ID,
		nil,
	))

	require.Equal(t, http.StatusNotFound, recorder.Code)
	_, err = store.Get(meta.ID)
	require.ErrorIs(t, err, service.ErrLocalImageAssetNotFound)
}
