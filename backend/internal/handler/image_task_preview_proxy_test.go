package handler

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type imageTaskPreviewRoundTripFunc func(*http.Request) (*http.Response, error)

func (f imageTaskPreviewRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestAsyncImageHandlerProxiesPreviewWithoutExposingUpstreamURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const upstreamURL = "https://cdn.upstream.example/signed/image.png?token=private"
	imageBytes := []byte("\x89PNG\r\n\x1a\npreview")
	client := &http.Client{Transport: imageTaskPreviewRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, upstreamURL, req.URL.String())
		return &http.Response{
			StatusCode: http.StatusOK,
			Header: http.Header{
				"Content-Type": []string{"image/png"},
			},
			Body:    io.NopCloser(bytes.NewReader(imageBytes)),
			Request: req,
		}, nil
	})}
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_proxy": {
			ID:                "imgtask_proxy",
			UserID:            7,
			APIKeyID:          9,
			Status:            service.ImageTaskStatusPreviewReady,
			PreviewRemoteURLs: []string{upstreamURL},
			Result:            []byte(`{"data":[{"url":"/api/v1/public/image-task-previews/imgtask_proxy/0"}]}`),
			ExpiresAt:         time.Now().Add(time.Hour).Unix(),
		},
	}}
	uploader := service.NewImageResultUploader(nil, "", 0, client)
	tasks := service.NewImageTaskServiceWithUploader(store, uploader, time.Hour, time.Minute)
	h := &AsyncImageHandler{tasks: tasks}
	router := gin.New()
	router.GET("/api/v1/public/image-task-previews/:task_id/:index", h.PreviewContent)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-task-previews/imgtask_proxy/0",
		nil,
	))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, imageBytes, recorder.Body.Bytes())
	require.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
	require.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
	require.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
	require.Empty(t, recorder.Header().Get("Location"))
	for name, values := range recorder.Header() {
		for _, value := range values {
			require.NotContains(t, strings.ToLower(value), "upstream.example")
			require.NotContains(t, strings.ToLower(name), "upstream.example")
		}
	}
}

func TestAsyncImageHandlerProxiesLegacyPreviewResult(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const upstreamURL = "https://cdn.upstream.example/legacy.png?token=private"
	imageBytes := []byte("\x89PNG\r\n\x1a\nlegacy")
	client := &http.Client{Transport: imageTaskPreviewRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/png"}},
			Body:       io.NopCloser(bytes.NewReader(imageBytes)),
			Request:    req,
		}, nil
	})}
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_legacy": {
			ID:        "imgtask_legacy",
			UserID:    7,
			APIKeyID:  9,
			Status:    service.ImageTaskStatusPreviewReady,
			Result:    []byte(`{"data":[{"url":"` + upstreamURL + `"}]}`),
			ExpiresAt: time.Now().Add(time.Hour).Unix(),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(
		store,
		service.NewImageResultUploader(nil, "", 0, client),
		time.Hour,
		time.Minute,
	)
	h := &AsyncImageHandler{tasks: tasks}
	router := gin.New()
	router.GET("/api/v1/public/image-task-previews/:task_id/:index", h.PreviewContent)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-task-previews/imgtask_legacy/0",
		nil,
	))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, imageBytes, recorder.Body.Bytes())
	require.Empty(t, recorder.Header().Get("Location"))
}

func TestAsyncImageHandlerPreviewProxyReturnsOpaqueNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_missing": {
			ID:        "imgtask_missing",
			Status:    service.ImageTaskStatusPreviewReady,
			ExpiresAt: time.Now().Add(time.Hour).Unix(),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	h := &AsyncImageHandler{tasks: tasks}
	router := gin.New()
	router.GET("/api/v1/public/image-task-previews/:task_id/:index", h.PreviewContent)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-task-previews/imgtask_missing/0",
		nil,
	))

	require.Equal(t, http.StatusNotFound, recorder.Code)
	require.NotContains(t, strings.ToLower(recorder.Body.String()), "http")
}

func TestAsyncImageHandlerPreviewProxyRequiresPrivateTaskURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_private": {
			ID:                "imgtask_private",
			Status:            service.ImageTaskStatusPreviewReady,
			PreviewRemoteURLs: []string{"http://127.0.0.1/private.png"},
			ExpiresAt:         time.Now().Add(time.Hour).Unix(),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	h := &AsyncImageHandler{tasks: tasks}
	router := gin.New()
	router.GET("/api/v1/public/image-task-previews/:task_id/:index", h.PreviewContent)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-task-previews/imgtask_private/0",
		nil,
	))

	require.Equal(t, http.StatusNotFound, recorder.Code)
	require.NotContains(t, recorder.Body.String(), "127.0.0.1")
}

func TestAsyncImageHandlerPreviewProxyUsesTaskCapabilityOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: make(map[string]*service.ImageTaskRecord)}
	require.NoError(t, store.Save(context.Background(), &service.ImageTaskRecord{
		ID:        "imgtask_capability",
		Status:    service.ImageTaskStatusPreviewReady,
		ExpiresAt: time.Now().Add(time.Hour).Unix(),
	}, time.Hour))
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	h := &AsyncImageHandler{tasks: tasks}
	router := gin.New()
	router.GET("/api/v1/public/image-task-previews/:task_id/:index", h.PreviewContent)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-task-previews/imgtask_capability/0",
		nil,
	))

	require.Equal(t, http.StatusNotFound, recorder.Code)
	require.NotContains(t, strings.ToLower(recorder.Body.String()), "authorization")
}

func TestAsyncImageHandlerMediaContentUsesOpaqueTaskURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const upstreamURL = "https://cdn.upstream.example/final/image.png?token=private"
	imageBytes := []byte("\x89PNG\r\n\x1a\nfinal")
	client := &http.Client{Transport: imageTaskPreviewRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, upstreamURL, req.URL.String())
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/png"}},
			Body:       io.NopCloser(bytes.NewReader(imageBytes)),
			Request:    req,
		}, nil
	})}
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_media": {
			ID:              "imgtask_media",
			Status:          service.ImageTaskStatusCompleted,
			MediaRemoteURLs: []string{upstreamURL},
			Result:          []byte(`{"data":[{"url":"/api/v1/public/image-task-media/imgtask_media/0"}]}`),
			ExpiresAt:       time.Now().Add(time.Hour).Unix(),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(
		store,
		service.NewImageResultUploader(nil, "", 0, client),
		time.Hour,
		time.Minute,
	)
	h := &AsyncImageHandler{tasks: tasks}
	router := gin.New()
	router.GET("/api/v1/public/image-task-media/:task_id/:index", h.MediaContent)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet,
		"/api/v1/public/image-task-media/imgtask_media/0",
		nil,
	))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, imageBytes, recorder.Body.Bytes())
	require.Empty(t, recorder.Header().Get("Location"))
	require.NotContains(t, strings.ToLower(recorder.Body.String()), "upstream.example")
}
