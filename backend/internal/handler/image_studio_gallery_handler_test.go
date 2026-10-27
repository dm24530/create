//go:build unit

package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
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

func TestDecodeImageStudioDataURL(t *testing.T) {
	raw := smallPNGForHandler()
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw)

	data, contentType, err := decodeImageStudioDataURL(dataURL)
	require.NoError(t, err)
	require.Equal(t, raw, data)
	require.Equal(t, "image/png", contentType)
}

func TestDecodeImageStudioDataURLRejectsNonImage(t *testing.T) {
	_, _, err := decodeImageStudioDataURL("data:text/plain;base64,aGVsbG8=")
	require.Error(t, err)
}

type galleryHandlerStoreStub struct {
	entries []*service.ImageStudioGalleryEntry
}

func (s *galleryHandlerStoreStub) Save(
	_ context.Context,
	entry *service.ImageStudioGalleryEntry,
	_ int64,
) error {
	s.entries = append(s.entries, entry)
	return nil
}

func (s *galleryHandlerStoreStub) List(
	context.Context,
	int64,
	int,
	*bool,
) ([]*service.ImageStudioGalleryEntry, error) {
	return s.entries, nil
}

func (s *galleryHandlerStoreStub) Count(context.Context, int64) (int64, error) {
	return int64(len(s.entries)), nil
}

func (s *galleryHandlerStoreStub) Pin(context.Context, int64, string, int64) error {
	return nil
}

func (s *galleryHandlerStoreStub) Unpin(context.Context, int64, string, int64) error {
	return nil
}

func (s *galleryHandlerStoreStub) SweepExpired(context.Context, int) ([]string, error) {
	return nil, nil
}

func (s *galleryHandlerStoreStub) ObjectKey(context.Context, int64, string) (string, error) {
	return "", service.ErrStudioWorkNotFound
}

func (s *galleryHandlerStoreStub) UpdateThumbURL(context.Context, int64, string, string) error {
	return nil
}

func (s *galleryHandlerStoreStub) Delete(context.Context, int64, string) error {
	return nil
}

type galleryHandlerSaverStub struct {
	saveCalls   int
	fetchCalls  int
	downloadURL string
}

func (s *galleryHandlerSaverStub) SaveImageWithKey(
	context.Context,
	string,
	string,
	[]byte,
) (string, string, error) {
	s.saveCalls++
	return "https://cdn.example.com/unexpected.png", "images/unexpected.png", nil
}

func (s *galleryHandlerSaverStub) DeleteObject(context.Context, string) error {
	return nil
}

func (s *galleryHandlerSaverStub) StudioWorksQuota() int {
	return 100
}

func (s *galleryHandlerSaverStub) GalleryRetention() time.Duration {
	return 7 * 24 * time.Hour
}

func (s *galleryHandlerSaverStub) FetchImageURL(
	context.Context,
	string,
) ([]byte, string, error) {
	s.fetchCalls++
	return nil, "", nil
}

func (s *galleryHandlerSaverStub) PresignImageObjectDownload(
	context.Context,
	string,
	string,
) (string, error) {
	return s.downloadURL, nil
}

func TestImageStudioGalleryDownloadURLReturnsSignedAttachment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	galleryStore := &galleryHandlerStoreStub{entries: []*service.ImageStudioGalleryEntry{
		{
			ID:        "work-1",
			UserID:    7,
			ObjectKey: "images/work-1.jpg",
			Format:    "jpg",
		},
	}}
	saver := &galleryHandlerSaverStub{
		downloadURL: "https://cdn.example.com/images/work-1.jpg?response-content-disposition=attachment",
	}
	h := NewImageStudioGalleryHandler(service.NewImageStudioGalleryService(galleryStore, saver), nil)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})
		c.Next()
	})
	router.GET("/api/v1/image-studio/gallery/:id/download-url", h.DownloadURL)

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/image-studio/gallery/work-1/download-url",
		nil,
	)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Contains(t, recorder.Body.String(), saver.downloadURL)
	require.Contains(t, recorder.Body.String(), "image-work-1.jpg")
}

func TestImageStudioGallerySaveFromTaskUsesPersistedObject(t *testing.T) {
	gin.SetMode(gin.TestMode)
	taskStore := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_owned": {
			ID:         "imgtask_owned",
			UserID:     7,
			APIKeyID:   9,
			Status:     service.ImageTaskStatusCompleted,
			HTTPStatus: http.StatusOK,
			Result: json.RawMessage(
				`{"data":[{"object_key":"images/users/7/task-owned.png","url":"https://gen.example.com/images/users/7/task-owned.png"}]}`,
			),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(taskStore, nil, time.Hour, time.Minute)
	galleryStore := &galleryHandlerStoreStub{}
	saver := &galleryHandlerSaverStub{}
	gallery := service.NewImageStudioGalleryService(galleryStore, saver)
	h := NewImageStudioGalleryHandler(gallery, tasks)

	router := galleryTaskTestRouter(7, h)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/image-studio/gallery/from-task",
		strings.NewReader(`{
			"task_id":"imgtask_owned",
			"image_index":0,
			"prompt":"cat",
			"model":"gpt-image-1",
			"size":"1024x1024",
			"format":"png",
			"saved":true,
			"object_key":"images/users/99/forged.png"
		}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Len(t, galleryStore.entries, 1)
	require.Equal(t, "images/users/7/task-owned.png", galleryStore.entries[0].ObjectKey)
	require.Equal(t, int64(7), galleryStore.entries[0].UserID)
	require.True(t, galleryStore.entries[0].Saved)
	require.Zero(t, saver.saveCalls, "saving from a completed task must not upload the image again")
	require.Zero(t, saver.fetchCalls, "saving from a completed task must not download the image again")
}

func TestImageStudioGallerySaveFromTaskRejectsAnotherUsersTask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	taskStore := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_other": {
			ID:       "imgtask_other",
			UserID:   99,
			APIKeyID: 9,
			Status:   service.ImageTaskStatusCompleted,
			Result:   json.RawMessage(`{"data":[{"object_key":"images/users/99/private.png"}]}`),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(taskStore, nil, time.Hour, time.Minute)
	galleryStore := &galleryHandlerStoreStub{}
	h := NewImageStudioGalleryHandler(
		service.NewImageStudioGalleryService(galleryStore, &galleryHandlerSaverStub{}),
		tasks,
	)

	recorder := serveGalleryTaskSave(galleryTaskTestRouter(7, h), `{
		"task_id":"imgtask_other",
		"prompt":"cat",
		"model":"gpt-image-1",
		"size":"1024x1024",
		"format":"png",
		"saved":true
	}`)

	require.Equal(t, http.StatusNotFound, recorder.Code)
	require.Empty(t, galleryStore.entries)
}

func TestImageStudioGallerySaveFromTaskRequiresCompletedTask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	taskStore := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_processing": {
			ID:       "imgtask_processing",
			UserID:   7,
			APIKeyID: 9,
			Status:   service.ImageTaskStatusProcessing,
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(taskStore, nil, time.Hour, time.Minute)
	galleryStore := &galleryHandlerStoreStub{}
	h := NewImageStudioGalleryHandler(
		service.NewImageStudioGalleryService(galleryStore, &galleryHandlerSaverStub{}),
		tasks,
	)

	recorder := serveGalleryTaskSave(galleryTaskTestRouter(7, h), `{
		"task_id":"imgtask_processing",
		"prompt":"cat",
		"model":"gpt-image-1",
		"size":"1024x1024",
		"format":"png",
		"saved":true
	}`)

	require.Equal(t, http.StatusConflict, recorder.Code)
	require.Empty(t, galleryStore.entries)
}

func TestImageStudioGallerySaveFromTaskReportsUnavailableGallery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	taskStore := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_owned": {
			ID:       "imgtask_owned",
			UserID:   7,
			APIKeyID: 9,
			Status:   service.ImageTaskStatusCompleted,
			Result:   json.RawMessage(`{"data":[{"object_key":"images/users/7/task-owned.png"}]}`),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(taskStore, nil, time.Hour, time.Minute)
	h := NewImageStudioGalleryHandler(nil, tasks)

	recorder := serveGalleryTaskSave(galleryTaskTestRouter(7, h), `{
		"task_id":"imgtask_owned",
		"prompt":"cat",
		"model":"gpt-image-1",
		"size":"1024x1024",
		"format":"png",
		"saved":true
	}`)

	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
}

func galleryTaskTestRouter(userID int64, handler *ImageStudioGalleryHandler) *gin.Engine {
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: userID})
		c.Next()
	})
	router.POST("/api/v1/image-studio/gallery/from-task", handler.SaveFromTask)
	return router
}

func serveGalleryTaskSave(router *gin.Engine, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/image-studio/gallery/from-task",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func smallPNGForHandler() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
		0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99,
		0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
		0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
}
