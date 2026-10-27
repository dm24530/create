package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type imageTaskMemoryStore struct {
	task    *ImageTaskRecord
	ttl     time.Duration
	saveErr error
	getErr  error
	idem    map[string]string
}

func (s *imageTaskMemoryStore) Save(_ context.Context, task *ImageTaskRecord, ttl time.Duration) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	copy := *task
	s.task = &copy
	s.ttl = ttl
	return nil
}

func (s *imageTaskMemoryStore) Get(_ context.Context, _ string) (*ImageTaskRecord, error) {
	if s.getErr != nil {
		return nil, s.getErr
	}
	if s.task == nil {
		return nil, ErrImageTaskNotFound
	}
	copy := *s.task
	return &copy, nil
}

func (s *imageTaskMemoryStore) ListPending(context.Context, int) ([]*ImageTaskRecord, error) {
	if s.task == nil {
		return nil, nil
	}
	copy := *s.task
	return []*ImageTaskRecord{&copy}, nil
}

func (s *imageTaskMemoryStore) Claim(context.Context, string, string, time.Duration) (bool, error) {
	return true, nil
}

func (s *imageTaskMemoryStore) RenewClaim(context.Context, string, string, time.Duration) (bool, error) {
	return true, nil
}

func (s *imageTaskMemoryStore) ReleaseClaim(context.Context, string, string) error {
	return nil
}

func (s *imageTaskMemoryStore) ClaimIdempotencyKey(_ context.Context, apiKeyID int64, keyHash, taskID string, _ time.Duration) (bool, error) {
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

func (s *imageTaskMemoryStore) GetIdempotencyTaskID(_ context.Context, apiKeyID int64, keyHash string) (string, error) {
	return s.idem[fmt.Sprintf("%d:%s", apiKeyID, keyHash)], nil
}

func (s *imageTaskMemoryStore) ReleaseIdempotencyKey(_ context.Context, apiKeyID int64, keyHash, taskID string) error {
	key := fmt.Sprintf("%d:%s", apiKeyID, keyHash)
	if s.idem[key] == taskID {
		delete(s.idem, key)
	}
	return nil
}

func TestImageTaskServiceDefaultExecutionTimeoutIsThreeMinutes(t *testing.T) {
	svc := NewImageTaskService(&imageTaskMemoryStore{})
	require.Equal(t, 3*time.Minute, svc.ExecutionTimeout())
}

func TestImageTaskServiceLifecycleAndOwnership(t *testing.T) {
	store := &imageTaskMemoryStore{}
	svc := NewImageTaskServiceWithOptions(store, time.Hour, 10*time.Minute)
	owner := ImageTaskOwner{UserID: 7, APIKeyID: 9}

	created, err := svc.Create(context.Background(), owner)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusProcessing, created.Status)
	require.Equal(t, created.ID, created.TaskID)
	require.Equal(t, "image.generation.task", created.Object)
	require.Equal(t, time.Hour, store.ttl)
	require.Equal(t, owner.UserID, store.task.UserID)
	require.Equal(t, owner.APIKeyID, store.task.APIKeyID)

	_, err = svc.Get(context.Background(), ImageTaskOwner{UserID: 7, APIKeyID: 10}, created.ID)
	require.ErrorIs(t, err, ErrImageTaskNotFound)

	result := json.RawMessage(`{"created":123,"data":[{"url":"https://example.test/image.png"}]}`)
	require.NoError(t, svc.Complete(context.Background(), created.ID, http.StatusOK, result))

	completed, err := svc.Get(context.Background(), owner, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusCompleted, completed.Status)
	require.Equal(t, http.StatusOK, completed.HTTPStatus)
	require.Equal(t, "https://example.test/image.png", completed.ImageURL)
	require.JSONEq(t, string(result), string(completed.Result))
	require.NotNil(t, completed.CompletedAt)
}

func TestImageTaskServiceInvalidResultBecomesFailed(t *testing.T) {
	store := &imageTaskMemoryStore{}
	svc := NewImageTaskServiceWithOptions(store, time.Hour, time.Minute)
	created, err := svc.Create(context.Background(), ImageTaskOwner{UserID: 1, APIKeyID: 2})
	require.NoError(t, err)

	require.NoError(t, svc.Complete(context.Background(), created.ID, http.StatusOK, json.RawMessage(`not-json`)))
	got, err := svc.Get(context.Background(), ImageTaskOwner{UserID: 1, APIKeyID: 2}, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusFailed, got.Status)
	require.Equal(t, http.StatusBadGateway, got.HTTPStatus)
	require.Contains(t, string(got.Error), "non-JSON")
}

func TestImageTaskServiceDoesNotStoreRawResultWhenObjectStorageIsDisabled(t *testing.T) {
	store := &imageTaskMemoryStore{}
	svc := NewImageTaskServiceWithResolver(store, func() (*ImageResultUploader, bool) {
		return nil, false
	}, time.Hour, time.Minute)
	created, err := svc.Create(context.Background(), ImageTaskOwner{UserID: 1, APIKeyID: 2})
	require.NoError(t, err)

	require.NoError(t, svc.Complete(
		context.Background(),
		created.ID,
		http.StatusOK,
		json.RawMessage(`{"data":[{"b64_json":"large-image-payload"}]}`),
	))

	got, err := svc.Get(context.Background(), ImageTaskOwner{UserID: 1, APIKeyID: 2}, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusFailed, got.Status)
	require.Equal(t, http.StatusServiceUnavailable, got.HTTPStatus)
	require.Empty(t, got.Result)
	require.Contains(t, string(got.Error), "object storage is unavailable")
}

func TestImageTaskServiceMapsStoreFailures(t *testing.T) {
	store := &imageTaskMemoryStore{saveErr: errors.New("redis down")}
	svc := NewImageTaskService(store)

	_, err := svc.Create(context.Background(), ImageTaskOwner{UserID: 1, APIKeyID: 2})
	require.ErrorIs(t, err, ErrImageTaskUnavailable)
}

func TestImageTaskServiceMarksFailedTaskRefundedOnce(t *testing.T) {
	store := &imageTaskMemoryStore{}
	svc := NewImageTaskServiceWithOptions(store, time.Hour, time.Minute)
	created, err := svc.Create(context.Background(), ImageTaskOwner{UserID: 1, APIKeyID: 2})
	require.NoError(t, err)
	require.NoError(t, svc.Fail(context.Background(), created.ID, http.StatusBadGateway, imageTaskErrorJSON("api_error", "upstream failed")))

	refundedAt := time.Now().UTC().Truncate(time.Second)
	require.NoError(t, svc.MarkRefunded(context.Background(), created.ID, 0.25, &refundedAt))
	require.NoError(t, svc.MarkRefunded(context.Background(), created.ID, 9.99, &refundedAt))

	got, err := svc.Get(context.Background(), ImageTaskOwner{UserID: 1, APIKeyID: 2}, created.ID)
	require.NoError(t, err)
	require.Equal(t, "refunded", got.RefundStatus)
	require.InDelta(t, 0.25, got.RefundAmount, 1e-12)
	require.NotNil(t, got.RefundedAt)
	require.Equal(t, refundedAt.Unix(), *got.RefundedAt)
}

func TestImageTaskServiceCreateWithExecutionCompressesBody(t *testing.T) {
	store := &imageTaskMemoryStore{}
	svc := NewImageTaskServiceWithOptions(store, time.Hour, time.Minute)
	body := []byte(`{"model":"grok-imagine","prompt":"draw a cat"}`)

	created, err := svc.CreateWithExecution(context.Background(), ImageTaskOwner{UserID: 7, APIKeyID: 9}, &ImageTaskExecution{
		Platform:       PlatformGrok,
		RequestPath:    "/v1/images/edits",
		ContentType:    "application/json",
		CompressedBody: body,
	})
	require.NoError(t, err)
	require.NotNil(t, store.task)
	require.NotNil(t, store.task.Execution)
	require.Equal(t, "gzip", store.task.Execution.BodyEncoding)
	require.NotEqual(t, body, store.task.Execution.CompressedBody)
	require.Equal(t, "/v1/images/edits", store.task.Execution.RequestPath)

	gotBody, err := store.task.Execution.DecompressedBody()
	require.NoError(t, err)
	require.Equal(t, body, gotBody)

	got, err := svc.Get(context.Background(), ImageTaskOwner{UserID: 7, APIKeyID: 9}, created.ID)
	require.NoError(t, err)
	require.Equal(t, ImageTaskStatusProcessing, got.Status)
	require.NotContains(t, string(mustImageTaskJSON(t, got)), "compressed_body")
}

func TestImageTaskServiceIdempotentCreateReplaysAndRejectsChangedRequest(t *testing.T) {
	store := &imageTaskMemoryStore{}
	svc := NewImageTaskServiceWithOptions(store, time.Hour, time.Minute)
	owner := ImageTaskOwner{UserID: 7, APIKeyID: 9}
	execution := &ImageTaskExecution{
		Platform:       PlatformOpenAI,
		RequestPath:    "/v1/images/generations",
		ContentType:    "application/json",
		CompressedBody: []byte(`{"model":"gpt-image-1","prompt":"cat"}`),
	}
	requestHash := ImageTaskRequestHash(execution.Platform, execution.RequestPath, "", execution.ContentType, execution.CompressedBody)

	first, replayed, err := svc.CreateWithExecutionIdempotent(
		context.Background(), owner, execution, "client-task-1", requestHash,
	)
	require.NoError(t, err)
	require.False(t, replayed)

	second, replayed, err := svc.CreateWithExecutionIdempotent(
		context.Background(), owner, execution, "client-task-1", requestHash,
	)
	require.NoError(t, err)
	require.True(t, replayed)
	require.Equal(t, first.ID, second.ID)

	_, _, err = svc.CreateWithExecutionIdempotent(
		context.Background(), owner, execution, "client-task-1", requestHash+"-changed",
	)
	require.ErrorIs(t, err, ErrImageTaskConflict)
}

func TestImageTaskRequestHashIgnoresMultipartBoundary(t *testing.T) {
	build := func(boundary string) (string, []byte) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.SetBoundary(boundary))
		require.NoError(t, writer.WriteField("model", "gpt-image-1"))
		require.NoError(t, writer.WriteField("prompt", "draw a cat"))
		part, err := writer.CreateFormFile("image", "reference.png")
		require.NoError(t, err)
		_, err = part.Write([]byte("image-bytes"))
		require.NoError(t, err)
		require.NoError(t, writer.Close())
		return writer.FormDataContentType(), body.Bytes()
	}
	contentTypeA, bodyA := build("boundary-a")
	contentTypeB, bodyB := build("boundary-b")

	hashA := ImageTaskRequestHash(PlatformOpenAI, "/v1/images/edits", "", contentTypeA, bodyA)
	hashB := ImageTaskRequestHash(PlatformOpenAI, "/v1/images/edits", "", contentTypeB, bodyB)
	require.Equal(t, hashA, hashB)

	contentTypeC, bodyC := build("boundary-c")
	bodyC = bytes.Replace(bodyC, []byte("draw a cat"), []byte("draw a dog"), 1)
	hashC := ImageTaskRequestHash(PlatformOpenAI, "/v1/images/edits", "", contentTypeC, bodyC)
	require.NotEqual(t, hashA, hashC)
}

func mustImageTaskJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return data
}
