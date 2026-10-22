package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type asyncImageMemoryStore struct {
	mu          sync.RWMutex
	tasks       map[string]*service.ImageTaskRecord
	claimDenied bool
	renewDenied bool
	idem        map[string]string
}

type asyncImageAPIKeyLoader struct {
	key *service.APIKey
	err error
}

type asyncImageLinkStore struct {
	link *service.UsageLogImageLink
	err  error
}

func (s *asyncImageLinkStore) Upsert(_ context.Context, link *service.UsageLogImageLink) error {
	if s.err != nil {
		return s.err
	}
	s.link = link
	return nil
}

func (s *asyncImageLinkStore) GetByToken(context.Context, string) (*service.UsageLogImageLink, error) {
	return nil, service.ErrUsageLogImageLinkNotFound
}

func (s *asyncImageLinkStore) DeleteExpired(context.Context, time.Time, int) (int64, error) {
	return 0, nil
}

func (l asyncImageAPIKeyLoader) GetByID(context.Context, int64) (*service.APIKey, error) {
	if l.err != nil {
		return nil, l.err
	}
	return l.key, nil
}

func (s *asyncImageMemoryStore) Save(_ context.Context, task *service.ImageTaskRecord, _ time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	copy := *task
	copy.Result = append(json.RawMessage(nil), task.Result...)
	copy.Error = append(json.RawMessage(nil), task.Error...)
	s.tasks[task.ID] = &copy
	return nil
}

func (s *asyncImageMemoryStore) Get(_ context.Context, id string) (*service.ImageTaskRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	task := s.tasks[id]
	if task == nil {
		return nil, service.ErrImageTaskNotFound
	}
	copy := *task
	copy.Result = append(json.RawMessage(nil), task.Result...)
	copy.Error = append(json.RawMessage(nil), task.Error...)
	return &copy, nil
}

func (s *asyncImageMemoryStore) ListPending(_ context.Context, limit int) ([]*service.ImageTaskRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*service.ImageTaskRecord, 0, limit)
	for _, task := range s.tasks {
		if task.CompletedAt != nil || task.Status == service.ImageTaskStatusCompleted || task.Status == service.ImageTaskStatusFailed {
			continue
		}
		copy := *task
		result = append(result, &copy)
		if limit > 0 && len(result) >= limit {
			break
		}
	}
	return result, nil
}

func (s *asyncImageMemoryStore) Claim(context.Context, string, string, time.Duration) (bool, error) {
	if s.claimDenied {
		return false, nil
	}
	return true, nil
}

func (s *asyncImageMemoryStore) RenewClaim(context.Context, string, string, time.Duration) (bool, error) {
	return !s.renewDenied, nil
}

func (s *asyncImageMemoryStore) ReleaseClaim(context.Context, string, string) error {
	return nil
}

func (s *asyncImageMemoryStore) ClaimIdempotencyKey(_ context.Context, apiKeyID int64, keyHash, taskID string, _ time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.idem == nil {
		s.idem = make(map[string]string)
	}
	key := fmt.Sprintf("%d:%s", apiKeyID, keyHash)
	if _, exists := s.idem[key]; exists {
		return false, nil
	}
	s.idem[key] = taskID
	return true, nil
}

func (s *asyncImageMemoryStore) GetIdempotencyTaskID(_ context.Context, apiKeyID int64, keyHash string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.idem[fmt.Sprintf("%d:%s", apiKeyID, keyHash)], nil
}

func (s *asyncImageMemoryStore) ReleaseIdempotencyKey(_ context.Context, apiKeyID int64, keyHash, taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := fmt.Sprintf("%d:%s", apiKeyID, keyHash)
	if s.idem[key] == taskID {
		delete(s.idem, key)
	}
	return nil
}

func TestAsyncImageHandlerSubmitAndPoll(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: make(map[string]*service.ImageTaskRecord)}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	release := make(chan struct{})
	h := &AsyncImageHandler{tasks: tasks}
	h.execute = func(_ string, c *gin.Context) {
		<-release
		c.JSON(http.StatusOK, gin.H{"created": 123, "data": []gin.H{{"url": "https://example.test/image.png"}}})
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		groupID := int64(3)
		c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{
			ID:      9,
			UserID:  7,
			GroupID: &groupID,
			Group:   &service.Group{ID: groupID, Platform: service.PlatformOpenAI, AllowImageGeneration: true},
		})
		c.Next()
	})
	router.POST("/v1/images/generations/async", h.Submit)
	router.GET("/v1/images/tasks/:task_id", h.Get)

	requestCtx, cancelRequest := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations/async", strings.NewReader(`{"model":"gpt-image-1","prompt":"cat"}`)).WithContext(requestCtx)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, http.StatusAccepted, w.Code)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.Equal(t, "3", w.Header().Get("Retry-After"))

	var accepted struct {
		TaskID  string `json:"task_id"`
		Status  string `json:"status"`
		PollURL string `json:"poll_url"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &accepted))
	require.Equal(t, service.ImageTaskStatusProcessing, accepted.Status)
	require.Equal(t, "/v1/images/tasks/"+accepted.TaskID, accepted.PollURL)
	require.Equal(t, accepted.PollURL, w.Header().Get("Location"))

	// The detached background request must survive completion of/cancellation
	// from the short submission request.
	cancelRequest()
	close(release)
	require.Eventually(t, func() bool {
		got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, accepted.TaskID)
		return err == nil && got.Status == service.ImageTaskStatusCompleted
	}, time.Second, 10*time.Millisecond)

	pollReq := httptest.NewRequest(http.MethodGet, accepted.PollURL, nil)
	pollWriter := httptest.NewRecorder()
	router.ServeHTTP(pollWriter, pollReq)
	require.Equal(t, http.StatusOK, pollWriter.Code)
	require.Equal(t, "no-store", pollWriter.Header().Get("Cache-Control"))
	require.Empty(t, pollWriter.Header().Get("Retry-After"))
	require.Contains(t, pollWriter.Body.String(), "https://example.test/image.png")
}

func TestAsyncImageHandlerSubmitReplaysIdempotencyKeyWithoutExecutingTwice(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: make(map[string]*service.ImageTaskRecord)}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	executions := make(chan struct{}, 2)
	h := &AsyncImageHandler{tasks: tasks}
	h.execute = func(_ string, c *gin.Context) {
		executions <- struct{}{}
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"url": "https://example.test/idempotent.png"}}})
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		groupID := int64(3)
		c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{
			ID:      9,
			UserID:  7,
			GroupID: &groupID,
			Group:   &service.Group{ID: groupID, Platform: service.PlatformOpenAI, AllowImageGeneration: true},
		})
		c.Next()
	})
	router.POST("/v1/images/generations/async", h.Submit)

	submit := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/images/generations/async", strings.NewReader(`{"model":"gpt-image-1","prompt":"cat"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "client-task-idempotent")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}

	first := submit()
	second := submit()
	require.Equal(t, http.StatusAccepted, first.Code)
	require.Equal(t, http.StatusAccepted, second.Code)
	require.Equal(t, "true", second.Header().Get("X-Idempotency-Replayed"))
	var firstBody, secondBody struct {
		TaskID string `json:"task_id"`
	}
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstBody))
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &secondBody))
	require.Equal(t, firstBody.TaskID, secondBody.TaskID)
	require.Eventually(t, func() bool { return len(executions) == 1 }, time.Second, 10*time.Millisecond)
	select {
	case <-executions:
	case <-time.After(50 * time.Millisecond):
		t.Fatal("idempotent replay did not execute the original task")
	}
	select {
	case <-executions:
		t.Fatal("idempotent replay executed upstream twice")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestAsyncImageHandlerAcceptsGeminiEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: make(map[string]*service.ImageTaskRecord)}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	h := &AsyncImageHandler{tasks: tasks}
	executed := make(chan struct{})
	h.execute = func(_ string, c *gin.Context) {
		model, _ := c.Get(asyncImageGeminiModelKey)
		require.Equal(t, "gemini-3.1-flash-image", model)
		body, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		require.JSONEq(t, `{"contents":[{"role":"user","parts":[{"text":"draw a cat"}]}]}`, string(body))
		c.JSON(http.StatusOK, map[string]any{
			"candidates": []map[string]any{{
				"content": map[string]any{
					"parts": []map[string]any{{
						"inlineData": map[string]string{
							"mimeType": "image/png",
							"data":     "aGVsbG8=",
						},
					}},
				},
			}},
		})
		close(executed)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		groupID := int64(3)
		c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{
			ID:      9,
			UserID:  7,
			GroupID: &groupID,
			Group:   &service.Group{ID: groupID, Platform: service.PlatformGemini, AllowImageGeneration: true},
		})
		c.Next()
	})
	router.POST("/v1/images/generations/async", h.Submit)

	body := `{
		"model":"gemini-3.1-flash-image",
		"request":{"contents":[{"role":"user","parts":[{"text":"draw a cat"}]}]}
	}`
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations/async", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusAccepted, w.Code)
	<-executed
	var accepted struct {
		TaskID string `json:"task_id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &accepted))
	require.Eventually(t, func() bool {
		got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, accepted.TaskID)
		return err == nil && got.Status == service.ImageTaskStatusCompleted
	}, time.Second, 10*time.Millisecond)
	got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, accepted.TaskID)
	require.NoError(t, err)
	require.Contains(t, string(got.Result), `"b64_json":"aGVsbG8="`)
}

// When object storage is not configured the feature is fully disabled: the
// endpoints must return 404 without creating a task or writing to Redis.
func TestAsyncImageHandlerDisabledReturns404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &asyncImageMemoryStore{tasks: make(map[string]*service.ImageTaskRecord)}
	tasks := service.NewImageTaskServiceWithOptions(store, time.Hour, time.Minute) // enabled == false
	h := &AsyncImageHandler{tasks: tasks}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		groupID := int64(3)
		c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{
			ID:      9,
			UserID:  7,
			GroupID: &groupID,
			Group:   &service.Group{ID: groupID, Platform: service.PlatformOpenAI, AllowImageGeneration: true},
		})
		c.Next()
	})
	router.POST("/v1/images/generations/async", h.Submit)
	router.GET("/v1/images/tasks/:task_id", h.Get)

	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations/async", strings.NewReader(`{"model":"gpt-image-1","prompt":"cat"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, http.StatusNotFound, w.Code)
	require.Contains(t, w.Body.String(), "not enabled")

	pollReq := httptest.NewRequest(http.MethodGet, "/v1/images/tasks/imgtask_missing", nil)
	pollWriter := httptest.NewRecorder()
	router.ServeHTTP(pollWriter, pollReq)
	require.Equal(t, http.StatusNotFound, pollWriter.Code)

	// No task was created / persisted.
	require.Empty(t, store.tasks)
}

func TestAsyncImageHandlerRecoveryFailsLegacyTaskWithoutExecution(t *testing.T) {
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_legacy": {
			ID:        "imgtask_legacy",
			UserID:    7,
			APIKeyID:  9,
			Status:    service.ImageTaskStatusProcessing,
			CreatedAt: 100,
			ExpiresAt: time.Now().Add(time.Hour).Unix(),
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	h := &AsyncImageHandler{tasks: tasks}

	h.recoverPending()

	got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, "imgtask_legacy")
	require.NoError(t, err)
	require.Equal(t, service.ImageTaskStatusFailed, got.Status)
	require.Equal(t, http.StatusServiceUnavailable, got.HTTPStatus)
	require.Contains(t, string(got.Error), "cannot be resumed")
}

func TestAsyncImageHandlerRecoveryFailsInterruptedStartedTask(t *testing.T) {
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_interrupted": {
			ID:        "imgtask_interrupted",
			UserID:    7,
			APIKeyID:  9,
			Status:    service.ImageTaskStatusProcessing,
			CreatedAt: 100,
			StartedAt: 110,
			ExpiresAt: time.Now().Add(time.Hour).Unix(),
			Execution: &service.ImageTaskExecution{
				Platform:       service.PlatformOpenAI,
				RequestPath:    "/v1/images/generations",
				ContentType:    "application/json",
				CompressedBody: []byte(`{"model":"gpt-image-1","prompt":"cat"}`),
			},
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	executed := make(chan struct{}, 1)
	h := &AsyncImageHandler{tasks: tasks}
	h.execute = func(string, *gin.Context) {
		executed <- struct{}{}
	}

	h.recoverPending()

	select {
	case <-executed:
		t.Fatal("an interrupted task must not be submitted upstream again")
	case <-time.After(50 * time.Millisecond):
	}
	got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, "imgtask_interrupted")
	require.NoError(t, err)
	require.Equal(t, service.ImageTaskStatusFailed, got.Status)
	require.Contains(t, string(got.Error), "cannot be confirmed safely")
}

func TestAsyncImageHandlerRecoverySkipsTaskWithActiveLease(t *testing.T) {
	body := []byte(`{"model":"gpt-image-1","prompt":"cat"}`)
	store := &asyncImageMemoryStore{
		tasks: map[string]*service.ImageTaskRecord{
			"imgtask_leased": {
				ID:        "imgtask_leased",
				UserID:    7,
				APIKeyID:  9,
				Status:    service.ImageTaskStatusProcessing,
				CreatedAt: 100,
				ExpiresAt: time.Now().Add(time.Hour).Unix(),
				Execution: &service.ImageTaskExecution{
					Platform:       service.PlatformOpenAI,
					RequestPath:    "/v1/images/generations",
					ContentType:    "application/json",
					CompressedBody: body,
				},
			},
		},
		claimDenied: true,
	}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	executed := make(chan struct{}, 1)
	h := &AsyncImageHandler{tasks: tasks}
	h.execute = func(string, *gin.Context) {
		executed <- struct{}{}
	}

	h.recoverPending()

	select {
	case <-executed:
		t.Fatal("task with an active lease must not be executed twice")
	case <-time.After(50 * time.Millisecond):
	}
	got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, "imgtask_leased")
	require.NoError(t, err)
	require.Equal(t, service.ImageTaskStatusProcessing, got.Status)
}

func TestAsyncImageHandlerLeaseFinalCheckRejectsLostOwnership(t *testing.T) {
	store := &asyncImageMemoryStore{
		tasks:       map[string]*service.ImageTaskRecord{},
		renewDenied: true,
	}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	h := &AsyncImageHandler{tasks: tasks}

	require.False(t, h.renewTaskLease("imgtask_stale"))
}

func TestAsyncImageHandlerRecordsGeneratedImageLinkByUsageRequestID(t *testing.T) {
	store := &asyncImageMemoryStore{tasks: make(map[string]*service.ImageTaskRecord)}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	created, err := tasks.Create(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9})
	require.NoError(t, err)
	require.NoError(t, tasks.Complete(
		context.Background(),
		created.ID,
		http.StatusOK,
		json.RawMessage(`{"data":[{"url":"https://cdn.example.test/generated.png"}]}`),
	))
	links := &asyncImageLinkStore{}
	h := &AsyncImageHandler{tasks: tasks, imageLinks: links}

	h.recordUsageImageLink(created.ID, "client:req-image-1")

	require.NotNil(t, links.link)
	require.Equal(t, "client:req-image-1", links.link.RequestID)
	require.Equal(t, "https://cdn.example.test/generated.png", links.link.ImageURL)
}

func TestAsyncImageHandlerRecoveryRestoresExecutionAndCompletesTask(t *testing.T) {
	body := []byte(`{"model":"grok-imagine-image","prompt":"cat"}`)
	store := &asyncImageMemoryStore{tasks: map[string]*service.ImageTaskRecord{
		"imgtask_restore": {
			ID:        "imgtask_restore",
			UserID:    7,
			APIKeyID:  9,
			Status:    service.ImageTaskStatusProcessing,
			CreatedAt: 100,
			ExpiresAt: time.Now().Add(time.Hour).Unix(),
			Execution: &service.ImageTaskExecution{
				Platform:       service.PlatformGrok,
				RequestPath:    "/v1/images/edits",
				ContentType:    "application/json",
				CompressedBody: body,
			},
		},
	}}
	tasks := service.NewImageTaskServiceWithUploader(store, nil, time.Hour, time.Minute)
	executed := make(chan struct{}, 1)
	h := &AsyncImageHandler{
		tasks:   tasks,
		apiKeys: asyncImageAPIKeyLoader{key: &service.APIKey{ID: 9, UserID: 7, Key: "sk-restored"}},
	}
	h.execute = func(platform string, c *gin.Context) {
		require.Equal(t, service.PlatformGrok, platform)
		require.Equal(t, "/v1/images/edits", c.Request.URL.Path)
		require.Equal(t, "Bearer sk-restored", c.Request.Header.Get("Authorization"))
		gotBody, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		require.Equal(t, body, gotBody)
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"url": "https://example.test/restored.png"}}})
		executed <- struct{}{}
	}

	h.recoverPending()

	select {
	case <-executed:
	case <-time.After(time.Second):
		t.Fatal("recovered task was not executed")
	}
	require.Eventually(t, func() bool {
		got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, "imgtask_restore")
		return err == nil && got.Status == service.ImageTaskStatusCompleted
	}, time.Second, 10*time.Millisecond)
	got, err := tasks.Get(context.Background(), service.ImageTaskOwner{UserID: 7, APIKeyID: 9}, "imgtask_restore")
	require.NoError(t, err)
	require.Equal(t, "https://example.test/restored.png", got.ImageURL)
}

func TestNewImageTaskContextRestoresRequestDetails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	apiKey := &service.APIKey{ID: 9, UserID: 7, Key: "sk-test"}
	body := []byte(`{"model":"grok-imagine-image","prompt":"cat"}`)

	tests := []struct {
		name         string
		execution    *service.ImageTaskExecution
		wantPath     string
		wantPlatform string
		wantModel    string
	}{
		{
			name: "openai image edit keeps original path",
			execution: &service.ImageTaskExecution{
				Platform:       service.PlatformOpenAI,
				RequestPath:    "/images/edits",
				ContentType:    "application/json",
				CompressedBody: body,
			},
			wantPath: "/images/edits",
		},
		{
			name: "grok image generation",
			execution: &service.ImageTaskExecution{
				Platform:       service.PlatformGrok,
				RequestPath:    "/v1/images/generations",
				ContentType:    "application/json",
				CompressedBody: body,
			},
			wantPath: "/v1/images/generations",
		},
		{
			name: "gemini legacy execution builds model path",
			execution: &service.ImageTaskExecution{
				Platform:       service.PlatformGemini,
				GeminiModel:    "gemini-3.1-flash-image",
				ContentType:    "application/json",
				CompressedBody: []byte(`{"contents":[]}`),
			},
			wantPath:  "/v1beta/models/gemini-3.1-flash-image:generateContent",
			wantModel: "gemini-3.1-flash-image",
		},
		{
			name: "antigravity restores forced platform",
			execution: &service.ImageTaskExecution{
				Platform:       service.PlatformAntigravity,
				GeminiModel:    "gemini-3.1-flash-image",
				ContentType:    "application/json",
				CompressedBody: []byte(`{"contents":[]}`),
			},
			wantPath:     "/v1beta/models/gemini-3.1-flash-image:generateContent",
			wantPlatform: service.PlatformAntigravity,
			wantModel:    "gemini-3.1-flash-image",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			task := &service.ImageTaskRecord{ID: "imgtask_context", Execution: tc.execution}
			got, recorder, gotCancel, err := newImageTaskContext(task, apiKey, ctx, cancel)
			require.NoError(t, err)
			require.NotNil(t, recorder)
			defer gotCancel()

			require.Equal(t, tc.wantPath, got.Request.URL.Path)
			require.Equal(t, "Bearer sk-test", got.Request.Header.Get("Authorization"))
			require.Equal(t, tc.execution.ContentType, got.Request.Header.Get("Content-Type"))
			require.Equal(t, tc.wantPlatform, mustForcePlatform(got))
			require.Equal(t, tc.wantModel, mustContextString(got, asyncImageGeminiModelKey))

			gotBody, readErr := io.ReadAll(got.Request.Body)
			require.NoError(t, readErr)
			wantBody, decompressErr := tc.execution.DecompressedBody()
			require.NoError(t, decompressErr)
			require.Equal(t, wantBody, gotBody)
		})
	}
}

func mustForcePlatform(c *gin.Context) string {
	platform, _ := middleware2.GetForcePlatformFromContext(c)
	return platform
}

func mustContextString(c *gin.Context, key string) string {
	value, exists := c.Get(key)
	if !exists {
		return ""
	}
	text, _ := value.(string)
	return text
}
