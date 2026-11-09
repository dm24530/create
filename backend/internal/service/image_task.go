package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	ImageTaskStatusProcessing   = "processing"
	ImageTaskStatusPreviewReady = "preview_ready"
	ImageTaskStatusReady        = "ready"
	ImageTaskStatusCompleted    = "completed"
	ImageTaskStatusFailed       = "failed"

	defaultImageTaskTTL              = 24 * time.Hour
	defaultImageTaskExecutionTimeout = 10 * time.Minute
)

var (
	ErrImageTaskNotFound        = infraerrors.New(http.StatusNotFound, "IMAGE_TASK_NOT_FOUND", "image task not found")
	ErrImageTaskForbidden       = infraerrors.New(http.StatusForbidden, "IMAGE_TASK_FORBIDDEN", "image task does not belong to this API key")
	ErrImageTaskUnavailable     = infraerrors.New(http.StatusServiceUnavailable, "IMAGE_TASK_UNAVAILABLE", "image task storage is unavailable")
	ErrImageTaskConflict        = infraerrors.New(http.StatusConflict, "IMAGE_TASK_IDEMPOTENCY_CONFLICT", "idempotency key reused with a different image request")
	ErrImageTaskContentNotFound = infraerrors.New(http.StatusNotFound, "IMAGE_TASK_CONTENT_NOT_FOUND", "image task original content is unavailable")
)

// ImageTaskRecord is the private Redis representation of an asynchronous image
// request. Ownership fields are intentionally omitted from the public view.
type ImageTaskRecord struct {
	ID           string              `json:"id"`
	UserID       int64               `json:"user_id"`
	APIKeyID     int64               `json:"api_key_id"`
	Status       string              `json:"status"`
	HTTPStatus   int                 `json:"http_status,omitempty"`
	Result       json.RawMessage     `json:"result,omitempty"`
	Error        json.RawMessage     `json:"error,omitempty"`
	CreatedAt    int64               `json:"created_at"`
	StartedAt    int64               `json:"started_at,omitempty"`
	CompletedAt  *int64              `json:"completed_at,omitempty"`
	ExpiresAt    int64               `json:"expires_at"`
	Execution    *ImageTaskExecution `json:"execution,omitempty"`
	RequestHash  string              `json:"request_hash,omitempty"`
	RefundStatus string              `json:"refund_status,omitempty"`
	RefundAmount float64             `json:"refund_amount,omitempty"`
	RefundedAt   *int64              `json:"refunded_at,omitempty"`
}

type ImageTaskExecution struct {
	Platform          string `json:"platform"`
	RequestPath       string `json:"request_path,omitempty"`
	GeminiModel       string `json:"gemini_model,omitempty"`
	OutputFormat      string `json:"output_format,omitempty"`
	ContentType       string `json:"content_type,omitempty"`
	CompressedBody    []byte `json:"compressed_body,omitempty"`
	BodyEncoding      string `json:"body_encoding,omitempty"`
	UsageRequestID    string `json:"usage_request_id,omitempty"`
	RequestInstanceID string `json:"request_instance_id,omitempty"`
}

// ImageTask is the API-safe task representation returned to callers.
type ImageTask struct {
	ID           string          `json:"id"`
	TaskID       string          `json:"task_id"`
	Object       string          `json:"object"`
	Status       string          `json:"status"`
	HTTPStatus   int             `json:"http_status,omitempty"`
	ImageURL     string          `json:"image_url,omitempty"`
	Result       json.RawMessage `json:"result,omitempty"`
	Error        json.RawMessage `json:"error,omitempty"`
	CreatedAt    int64           `json:"created_at"`
	CompletedAt  *int64          `json:"completed_at,omitempty"`
	ExpiresAt    int64           `json:"expires_at"`
	RefundStatus string          `json:"refund_status,omitempty"`
	RefundAmount float64         `json:"refund_amount,omitempty"`
	RefundedAt   *int64          `json:"refunded_at,omitempty"`
}

type ImageTaskOwner struct {
	UserID   int64
	APIKeyID int64
}

type ImageTaskStore interface {
	Save(ctx context.Context, task *ImageTaskRecord, ttl time.Duration) error
	Get(ctx context.Context, id string) (*ImageTaskRecord, error)
	ListPending(ctx context.Context, limit int) ([]*ImageTaskRecord, error)
	Claim(ctx context.Context, id, owner string, ttl time.Duration) (bool, error)
	RenewClaim(ctx context.Context, id, owner string, ttl time.Duration) (bool, error)
	ReleaseClaim(ctx context.Context, id, owner string) error
	ClaimIdempotencyKey(ctx context.Context, apiKeyID int64, keyHash, taskID string, ttl time.Duration) (bool, error)
	GetIdempotencyTaskID(ctx context.Context, apiKeyID int64, keyHash string) (string, error)
	ReleaseIdempotencyKey(ctx context.Context, apiKeyID int64, keyHash, taskID string) error
}

// ImageStorageResolver reports the currently effective object-storage binding.
// It exists so the async image feature can be switched on and off from the admin
// UI without a restart: the wiring below is fixed at startup, but the answer to
// "is object storage configured right now" is re-read (and cached) per call.
type ImageStorageResolver func() (uploader *ImageResultUploader, enabled bool)

type ImageTaskService struct {
	store            ImageTaskStore
	uploader         *ImageResultUploader
	enabled          bool
	resolve          ImageStorageResolver
	ttl              time.Duration
	executionTimeout time.Duration
}

func NewImageTaskService(store ImageTaskStore) *ImageTaskService {
	return NewImageTaskServiceWithOptions(store, defaultImageTaskTTL, defaultImageTaskExecutionTimeout)
}

func NewImageTaskServiceWithOptions(store ImageTaskStore, ttl, executionTimeout time.Duration) *ImageTaskService {
	if ttl <= 0 {
		ttl = defaultImageTaskTTL
	}
	if executionTimeout <= 0 {
		executionTimeout = defaultImageTaskExecutionTimeout
	}
	return &ImageTaskService{store: store, ttl: ttl, executionTimeout: executionTimeout}
}

// NewImageTaskServiceWithUploader 构造一个已启用的图片任务服务：结果会先经 uploader
// 转存到对象存储再落 Redis。uploader 为 nil 时不做转存（仅用于测试）。
func NewImageTaskServiceWithUploader(store ImageTaskStore, uploader *ImageResultUploader, ttl, executionTimeout time.Duration) *ImageTaskService {
	s := NewImageTaskServiceWithOptions(store, ttl, executionTimeout)
	s.uploader = uploader
	s.enabled = true
	return s
}

// NewImageTaskServiceWithResolver 构造一个由 resolver 决定启用状态的服务：
// 开关与凭证来自后台设置，保存后立即生效，无需重启。
func NewImageTaskServiceWithResolver(store ImageTaskStore, resolve ImageStorageResolver, ttl, executionTimeout time.Duration) *ImageTaskService {
	s := NewImageTaskServiceWithOptions(store, ttl, executionTimeout)
	s.resolve = resolve
	return s
}

// current 返回当前生效的 uploader 与启用状态。
// 注入了 resolver 时以 resolver 为准（后台设置可热切换），否则回落到构造时固定的值。
func (s *ImageTaskService) current() (*ImageResultUploader, bool) {
	if s == nil {
		return nil, false
	}
	if s.resolve != nil {
		return s.resolve()
	}
	return s.uploader, s.enabled
}

// Enabled 表示异步图片任务功能是否可用（总开关 + 凭证齐全）。
// 关闭时 handler 直接返回 404，不创建任务、不写 Redis。
func (s *ImageTaskService) Enabled() bool {
	if s == nil || s.store == nil {
		return false
	}
	_, enabled := s.current()
	return enabled
}

// Pollable 表示已创建的任务能否被查询。
// 比 Enabled 弱：只要 store 可用即可，从而在功能被关掉后仍能取回进行中的任务结果。
func (s *ImageTaskService) Pollable() bool {
	return s != nil && s.store != nil
}

func (s *ImageTaskService) ExecutionTimeout() time.Duration {
	if s == nil || s.executionTimeout <= 0 {
		return defaultImageTaskExecutionTimeout
	}
	return s.executionTimeout
}

func (s *ImageTaskService) Create(ctx context.Context, owner ImageTaskOwner) (*ImageTask, error) {
	return s.CreateWithExecution(ctx, owner, nil)
}

func (s *ImageTaskService) CreateWithExecution(
	ctx context.Context,
	owner ImageTaskOwner,
	execution *ImageTaskExecution,
) (*ImageTask, error) {
	if s == nil || s.store == nil {
		return nil, ErrImageTaskUnavailable
	}
	if execution != nil {
		compressed, err := compressImageTaskBody(execution.CompressedBody)
		if err != nil {
			return nil, ErrImageTaskUnavailable.WithCause(err)
		}
		copyExecution := *execution
		copyExecution.CompressedBody = compressed
		copyExecution.BodyEncoding = "gzip"
		execution = &copyExecution
	}
	now := time.Now().UTC()
	task := &ImageTaskRecord{
		ID:        "imgtask_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		UserID:    owner.UserID,
		APIKeyID:  owner.APIKeyID,
		Status:    ImageTaskStatusProcessing,
		CreatedAt: now.Unix(),
		ExpiresAt: now.Add(s.ttl).Unix(),
		Execution: execution,
	}
	if err := s.store.Save(ctx, task, s.ttl); err != nil {
		return nil, ErrImageTaskUnavailable.WithCause(err)
	}
	return s.imageTaskToPublic(task), nil
}

func (s *ImageTaskService) CreateWithExecutionIdempotent(
	ctx context.Context,
	owner ImageTaskOwner,
	execution *ImageTaskExecution,
	idempotencyKey string,
	requestHash string,
) (*ImageTask, bool, error) {
	key, err := NormalizeIdempotencyKey(idempotencyKey)
	if err != nil {
		return nil, false, err
	}
	if key == "" {
		task, createErr := s.CreateWithExecution(ctx, owner, execution)
		return task, false, createErr
	}
	if s == nil || s.store == nil {
		return nil, false, ErrImageTaskUnavailable
	}
	if execution == nil {
		task, createErr := s.CreateWithExecution(ctx, owner, nil)
		return task, false, createErr
	}
	keyHash := HashIdempotencyKey(key)
	taskID := "imgtask_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	claimed, err := s.store.ClaimIdempotencyKey(ctx, owner.APIKeyID, keyHash, taskID, s.ttl)
	if err != nil {
		return nil, false, ErrImageTaskUnavailable.WithCause(err)
	}
	if !claimed {
		for attempt := 0; attempt < 40; attempt++ {
			existingID, lookupErr := s.store.GetIdempotencyTaskID(ctx, owner.APIKeyID, keyHash)
			if lookupErr != nil {
				return nil, false, ErrImageTaskUnavailable.WithCause(lookupErr)
			}
			if existingID != "" {
				existing, getErr := s.GetRecord(ctx, existingID)
				if getErr != nil {
					return nil, false, getErr
				}
				if existing.UserID != owner.UserID || existing.APIKeyID != owner.APIKeyID {
					return nil, false, ErrImageTaskNotFound
				}
				if existing.RequestHash != requestHash {
					return nil, false, ErrImageTaskConflict
				}
				return s.imageTaskToPublic(existing), true, nil
			}
			time.Sleep(25 * time.Millisecond)
		}
		return nil, false, ErrImageTaskUnavailable
	}

	compressed, err := compressImageTaskBody(execution.CompressedBody)
	if err != nil {
		_ = s.store.ReleaseIdempotencyKey(ctx, owner.APIKeyID, keyHash, taskID)
		return nil, false, ErrImageTaskUnavailable.WithCause(err)
	}
	copyExecution := *execution
	copyExecution.CompressedBody = compressed
	copyExecution.BodyEncoding = "gzip"
	now := time.Now().UTC()
	task := &ImageTaskRecord{
		ID:          taskID,
		UserID:      owner.UserID,
		APIKeyID:    owner.APIKeyID,
		Status:      ImageTaskStatusProcessing,
		CreatedAt:   now.Unix(),
		ExpiresAt:   now.Add(s.ttl).Unix(),
		Execution:   &copyExecution,
		RequestHash: requestHash,
	}
	if err := s.store.Save(ctx, task, s.ttl); err != nil {
		_ = s.store.ReleaseIdempotencyKey(ctx, owner.APIKeyID, keyHash, taskID)
		return nil, false, ErrImageTaskUnavailable.WithCause(err)
	}
	return s.imageTaskToPublic(task), false, nil
}

func ImageTaskRequestHash(platform, requestPath, geminiModel, contentType string, body []byte) string {
	sum := sha256.New()
	mediaType := strings.TrimSpace(strings.Split(contentType, ";")[0])
	if parsed, _, err := mime.ParseMediaType(contentType); err == nil && parsed != "" {
		mediaType = parsed
	}
	for _, part := range []string{platform, requestPath, geminiModel, mediaType} {
		_, _ = sum.Write([]byte(part))
		_, _ = sum.Write([]byte{0})
	}
	if !hashMultipartImageTaskBody(sum, contentType, body) {
		_, _ = sum.Write(body)
	}
	return fmt.Sprintf("%x", sum.Sum(nil))
}

func hashMultipartImageTaskBody(sum io.Writer, contentType string, body []byte) bool {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") || params["boundary"] == "" {
		return false
	}
	reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
	entries := make([]string, 0)
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return false
		}
		data, err := io.ReadAll(part)
		if err != nil {
			return false
		}
		entries = append(entries, strings.Join([]string{
			part.FormName(),
			part.FileName(),
			part.Header.Get("Content-Type"),
			string(data),
		}, "\x00"))
	}
	sort.Strings(entries)
	for _, entry := range entries {
		_, _ = sum.Write([]byte(entry))
		_, _ = sum.Write([]byte{0})
	}
	return true
}

func (s *ImageTaskService) GetRecord(ctx context.Context, id string) (*ImageTaskRecord, error) {
	if s == nil || s.store == nil {
		return nil, ErrImageTaskUnavailable
	}
	task, err := s.store.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, ErrImageTaskNotFound) {
			return nil, ErrImageTaskNotFound
		}
		return nil, ErrImageTaskUnavailable.WithCause(err)
	}
	return task, nil
}

func (s *ImageTaskService) ListPending(ctx context.Context, limit int) ([]*ImageTaskRecord, error) {
	if s == nil || s.store == nil {
		return nil, ErrImageTaskUnavailable
	}
	if limit <= 0 {
		limit = 100
	}
	return s.store.ListPending(ctx, limit)
}

func (s *ImageTaskService) Claim(ctx context.Context, id string, ttl time.Duration) (bool, error) {
	if s == nil || s.store == nil {
		return false, ErrImageTaskUnavailable
	}
	return s.store.Claim(ctx, id, taskLeaseOwner(), ttl)
}

func (s *ImageTaskService) RenewClaim(ctx context.Context, id string, ttl time.Duration) (bool, error) {
	if s == nil || s.store == nil {
		return false, ErrImageTaskUnavailable
	}
	return s.store.RenewClaim(ctx, id, taskLeaseOwner(), ttl)
}

func (s *ImageTaskService) ReleaseClaim(ctx context.Context, id string) error {
	if s == nil || s.store == nil {
		return nil
	}
	return s.store.ReleaseClaim(ctx, id, taskLeaseOwner())
}

func (s *ImageTaskService) MarkStarted(ctx context.Context, id string) error {
	if s == nil || s.store == nil {
		return ErrImageTaskUnavailable
	}
	task, err := s.store.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, ErrImageTaskNotFound) {
			return ErrImageTaskNotFound
		}
		return ErrImageTaskUnavailable.WithCause(err)
	}
	if task.StartedAt > 0 {
		return nil
	}
	task.StartedAt = time.Now().UTC().Unix()
	if err := s.store.Save(ctx, task, s.ttl); err != nil {
		return ErrImageTaskUnavailable.WithCause(err)
	}
	return nil
}

func (s *ImageTaskService) MarkRefunded(
	ctx context.Context,
	id string,
	amount float64,
	refundedAt *time.Time,
) error {
	if s == nil || s.store == nil {
		return ErrImageTaskUnavailable
	}
	task, err := s.store.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, ErrImageTaskNotFound) {
			return ErrImageTaskNotFound
		}
		return ErrImageTaskUnavailable.WithCause(err)
	}
	if task.RefundStatus == "refunded" {
		return nil
	}
	task.RefundStatus = "refunded"
	task.RefundAmount = amount
	if refundedAt == nil {
		now := time.Now().UTC().Unix()
		task.RefundedAt = &now
	} else {
		unix := refundedAt.UTC().Unix()
		task.RefundedAt = &unix
	}
	if err := s.store.Save(ctx, task, s.ttl); err != nil {
		return ErrImageTaskUnavailable.WithCause(err)
	}
	return nil
}

var imageTaskLeaseOwner = newImageTaskLeaseOwner()

func newImageTaskLeaseOwner() string {
	return "image_task_worker_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

func taskLeaseOwner() string {
	return imageTaskLeaseOwner
}

func compressImageTaskBody(body []byte) ([]byte, error) {
	if len(body) == 0 {
		return nil, nil
	}
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(body); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func (e *ImageTaskExecution) DecompressedBody() ([]byte, error) {
	if e == nil || len(e.CompressedBody) == 0 {
		return nil, nil
	}
	if e.BodyEncoding != "gzip" {
		return append([]byte(nil), e.CompressedBody...), nil
	}
	reader, err := gzip.NewReader(bytes.NewReader(e.CompressedBody))
	if err != nil {
		return nil, err
	}
	defer func() { _ = reader.Close() }()
	return io.ReadAll(reader)
}

func (s *ImageTaskService) Get(ctx context.Context, owner ImageTaskOwner, id string) (*ImageTask, error) {
	if s == nil || s.store == nil {
		return nil, ErrImageTaskUnavailable
	}
	task, err := s.store.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, ErrImageTaskNotFound) {
			return nil, ErrImageTaskNotFound
		}
		return nil, ErrImageTaskUnavailable.WithCause(err)
	}
	if task.UserID != owner.UserID || task.APIKeyID != owner.APIKeyID {
		// Do not reveal whether a random task ID exists for another caller.
		return nil, ErrImageTaskNotFound
	}
	return s.imageTaskToPublic(task), nil
}

func (s *ImageTaskService) OpenLocalAssetContent(
	ctx context.Context,
	owner ImageTaskOwner,
	id string,
	index int,
) (*LocalImageAssetMetadata, *os.File, error) {
	if s == nil || s.store == nil {
		return nil, nil, ErrImageTaskUnavailable
	}
	task, err := s.store.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, ErrImageTaskNotFound) {
			return nil, nil, ErrImageTaskNotFound
		}
		return nil, nil, ErrImageTaskUnavailable.WithCause(err)
	}
	if task.UserID != owner.UserID || task.APIKeyID != owner.APIKeyID {
		return nil, nil, ErrImageTaskNotFound
	}
	uploader, _ := s.current()
	if uploader == nil || uploader.localAssets == nil {
		return nil, nil, ErrImageTaskContentNotFound
	}
	assetID, err := imageTaskLocalAssetID(task.Result, index)
	if err != nil {
		return nil, nil, ErrImageTaskContentNotFound.WithCause(err)
	}
	meta, file, err := uploader.localAssets.Open(assetID)
	if err != nil {
		if errors.Is(err, ErrLocalImageAssetNotFound) {
			return nil, nil, ErrImageTaskContentNotFound
		}
		return nil, nil, ErrImageTaskContentNotFound.WithCause(err)
	}
	return meta, file, nil
}

func (s *ImageTaskService) OriginalRemoteURL(
	ctx context.Context,
	owner ImageTaskOwner,
	id string,
	index int,
) (string, error) {
	if s == nil || s.store == nil {
		return "", ErrImageTaskUnavailable
	}
	task, err := s.store.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, ErrImageTaskNotFound) {
			return "", ErrImageTaskNotFound
		}
		return "", ErrImageTaskUnavailable.WithCause(err)
	}
	if task.UserID != owner.UserID || task.APIKeyID != owner.APIKeyID {
		return "", ErrImageTaskNotFound
	}
	uploader, _ := s.current()
	if uploader == nil || uploader.localAssets == nil {
		return "", ErrImageTaskContentNotFound
	}
	assetID, err := imageTaskLocalAssetID(task.Result, index)
	if err != nil {
		return "", ErrImageTaskContentNotFound.WithCause(err)
	}
	meta, err := uploader.localAssets.Get(assetID)
	if err != nil || !meta.Uploaded || strings.TrimSpace(meta.RemoteURL) == "" {
		return "", ErrImageTaskContentNotFound
	}
	return strings.TrimSpace(meta.RemoteURL), nil
}

func imageTaskLocalAssetID(result json.RawMessage, index int) (string, error) {
	if index < 0 {
		index = 0
	}
	var payload struct {
		Data []struct {
			LocalAssetID string `json:"local_asset_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return "", err
	}
	if index >= len(payload.Data) {
		return "", errors.New("image task content index is out of range")
	}
	assetID := strings.TrimSpace(payload.Data[index].LocalAssetID)
	if assetID == "" {
		return "", errors.New("image task has no local original")
	}
	return assetID, nil
}

// GetByIdempotencyKey lets a client recover a task whose submit response was
// lost because the browser navigated away or the network dropped.
func (s *ImageTaskService) GetByIdempotencyKey(
	ctx context.Context,
	owner ImageTaskOwner,
	idempotencyKey string,
) (*ImageTask, error) {
	if s == nil || s.store == nil {
		return nil, ErrImageTaskUnavailable
	}
	key, err := NormalizeIdempotencyKey(idempotencyKey)
	if err != nil {
		return nil, err
	}
	if key == "" {
		return nil, ErrImageTaskNotFound
	}
	taskID, err := s.store.GetIdempotencyTaskID(ctx, owner.APIKeyID, HashIdempotencyKey(key))
	if err != nil {
		return nil, ErrImageTaskUnavailable.WithCause(err)
	}
	if taskID == "" {
		return nil, ErrImageTaskNotFound
	}
	return s.Get(ctx, owner, taskID)
}

func (s *ImageTaskService) Complete(ctx context.Context, id string, statusCode int, result json.RawMessage) error {
	if !json.Valid(result) {
		return s.Fail(ctx, id, http.StatusBadGateway, imageTaskErrorJSON("api_error", "upstream returned a non-JSON image response"))
	}
	uploader, storageEnabled := s.current()
	if s.resolve != nil && (!storageEnabled || uploader == nil) {
		return s.Fail(ctx, id, http.StatusServiceUnavailable, imageTaskErrorJSON(
			"api_error",
			"object storage is unavailable; the generated image was not persisted",
		))
	}
	if uploader != nil {
		task, err := s.GetRecord(ctx, id)
		if err != nil {
			return err
		}
		outputFormat := ""
		if task.Execution != nil {
			outputFormat = task.Execution.OutputFormat
		}
		previewUpdates := 0
		rewritten, err := uploader.RewriteWithPreview(ctx, task.UserID, id, result, func(preview json.RawMessage) error {
			if previewUpdates >= 2 {
				return nil
			}
			if err := s.saveState(ctx, id, ImageTaskStatusPreviewReady, statusCode, preview, nil, false); err != nil {
				return err
			}
			previewUpdates++
			return nil
		}, ImageRewriteOptions{OutputFormat: outputFormat})
		if err != nil {
			logger.L().Error("image_task.offload_failed", zap.String("task_id", id), zap.Error(err))
			finalized, finalizeErr := s.FinalizePreview(ctx, id)
			if finalized && finalizeErr == nil {
				return nil
			}
			if finalizeErr != nil {
				logger.L().Error("image_task.preview_fallback_failed", zap.String("task_id", id), zap.Error(finalizeErr))
			}
			// 连预览也无法持久化时直接失败，绝不把大 blob 落 Redis。
			return s.Fail(ctx, id, http.StatusBadGateway, imageTaskErrorJSON("api_error", "failed to store generated image to object storage"))
		}
		result = rewritten
	}
	status := ImageTaskStatusCompleted
	if imageResultHasLocalAsset(result) {
		status = ImageTaskStatusReady
	}
	return s.finish(ctx, id, status, statusCode, result, nil)
}

// FinalizePreview completes a task from its already-published preview without
// re-running the upstream request. This is the recovery path after a process
// restart between preview publication and full-size persistence.
func (s *ImageTaskService) FinalizePreview(ctx context.Context, id string) (bool, error) {
	if s == nil || s.store == nil {
		return false, ErrImageTaskUnavailable
	}
	record, err := s.store.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		return false, err
	}
	if record.Status != ImageTaskStatusPreviewReady {
		return false, nil
	}
	uploader, enabled := s.current()
	if !enabled || uploader == nil {
		return false, ErrImageTaskUnavailable
	}
	result, err := uploader.PersistPreviewResult(ctx, record.UserID, record.ID, record.Result)
	if err != nil {
		return false, err
	}
	if err := s.finish(ctx, record.ID, ImageTaskStatusCompleted, record.HTTPStatus, result, nil); err != nil {
		return false, err
	}
	return true, nil
}

func (s *ImageTaskService) Fail(ctx context.Context, id string, statusCode int, taskErr json.RawMessage) error {
	if !json.Valid(taskErr) {
		taskErr = imageTaskErrorJSON("api_error", "image generation failed")
	}
	return s.finish(ctx, id, ImageTaskStatusFailed, statusCode, nil, taskErr)
}

func (s *ImageTaskService) finish(ctx context.Context, id, status string, statusCode int, result, taskErr json.RawMessage) error {
	return s.saveState(ctx, id, status, statusCode, result, taskErr, true)
}

func (s *ImageTaskService) saveState(
	ctx context.Context,
	id, status string,
	statusCode int,
	result, taskErr json.RawMessage,
	terminal bool,
) error {
	if s == nil || s.store == nil {
		return ErrImageTaskUnavailable
	}
	task, err := s.store.Get(ctx, id)
	if err != nil {
		if errors.Is(err, ErrImageTaskNotFound) {
			return ErrImageTaskNotFound
		}
		return ErrImageTaskUnavailable.WithCause(err)
	}
	now := time.Now().UTC()
	task.Status = status
	task.HTTPStatus = statusCode
	task.Result = result
	task.Error = taskErr
	if terminal {
		completedAt := now.Unix()
		task.CompletedAt = &completedAt
	} else {
		task.CompletedAt = nil
	}
	task.ExpiresAt = now.Add(s.ttl).Unix()
	if err := s.store.Save(ctx, task, s.ttl); err != nil {
		return ErrImageTaskUnavailable.WithCause(err)
	}
	return nil
}

func (s *ImageTaskService) imageTaskToPublic(task *ImageTaskRecord) *ImageTask {
	public := imageTaskToPublic(task)
	if public == nil || len(public.Result) == 0 {
		return public
	}
	uploader, _ := s.current()
	var localAssets *LocalImageAssetStore
	if uploader != nil {
		localAssets = uploader.localAssets
	}
	published := imageResultLocalAssetsPublished(public.Result, localAssets)
	result, err := publicImageTaskResult(public.Result, localAssets)
	if err != nil {
		logger.L().Warn("image_task.public_result_projection_failed",
			zap.String("task_id", task.ID),
			zap.Error(err))
		return public
	}
	public.Result = result
	public.ImageURL = firstImageTaskURL(result)
	if task.Status == ImageTaskStatusReady && published {
		public.Status = ImageTaskStatusCompleted
	}
	return public
}

func imageResultHasLocalAsset(result json.RawMessage) bool {
	var payload struct {
		Data []struct {
			LocalAssetID string `json:"local_asset_id"`
		} `json:"data"`
	}
	if json.Unmarshal(result, &payload) != nil {
		return false
	}
	for _, item := range payload.Data {
		if strings.TrimSpace(item.LocalAssetID) != "" {
			return true
		}
	}
	return false
}

func imageResultLocalAssetsPublished(result json.RawMessage, localAssets *LocalImageAssetStore) bool {
	var payload struct {
		Data []struct {
			LocalAssetID string `json:"local_asset_id"`
		} `json:"data"`
	}
	if json.Unmarshal(result, &payload) != nil {
		return false
	}
	found := false
	for _, item := range payload.Data {
		assetID := strings.TrimSpace(item.LocalAssetID)
		if assetID == "" {
			continue
		}
		found = true
		if localAssets == nil {
			return false
		}
		meta, err := localAssets.Get(assetID)
		if err != nil || !meta.Uploaded || strings.TrimSpace(meta.RemoteURL) == "" {
			return false
		}
	}
	return found
}

func publicImageTaskResult(result json.RawMessage, localAssets *LocalImageAssetStore) (json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(result, &top); err != nil {
		return nil, err
	}
	rawData, ok := top["data"]
	if !ok {
		return result, nil
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(rawData, &items); err != nil {
		return nil, err
	}
	for _, item := range items {
		rawAssetID, ok := item["local_asset_id"]
		if !ok {
			continue
		}
		var assetID string
		if err := json.Unmarshal(rawAssetID, &assetID); err != nil {
			continue
		}
		assetID = strings.TrimSpace(assetID)
		if assetID == "" {
			continue
		}
		delete(item, "url")
		delete(item, "display_url")
		delete(item, "local_asset_id")
		item["original_ready"] = encodedJSON(true)
		item["upload_status"] = encodedJSON("pending")
		if localAssets == nil {
			continue
		}
		meta, err := localAssets.Get(assetID)
		if err == nil && meta.Uploaded && strings.TrimSpace(meta.RemoteURL) != "" {
			item["url"] = encodedJSON(strings.TrimSpace(meta.RemoteURL))
			item["upload_status"] = encodedJSON("uploaded")
		}
	}
	return imageResultWithItems(top, items)
}

func imageTaskToPublic(task *ImageTaskRecord) *ImageTask {
	if task == nil {
		return nil
	}
	return &ImageTask{
		ID:           task.ID,
		TaskID:       task.ID,
		Object:       "image.generation.task",
		Status:       task.Status,
		HTTPStatus:   task.HTTPStatus,
		ImageURL:     firstImageTaskURL(task.Result),
		Result:       task.Result,
		Error:        task.Error,
		CreatedAt:    task.CreatedAt,
		CompletedAt:  task.CompletedAt,
		ExpiresAt:    task.ExpiresAt,
		RefundStatus: task.RefundStatus,
		RefundAmount: task.RefundAmount,
		RefundedAt:   task.RefundedAt,
	}
}

func firstImageTaskURL(result json.RawMessage) string {
	if len(result) == 0 || !json.Valid(result) {
		return ""
	}
	var response struct {
		Data []struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if json.Unmarshal(result, &response) != nil || len(response.Data) == 0 {
		return ""
	}
	return strings.TrimSpace(response.Data[0].URL)
}

func imageTaskErrorJSON(errorType, message string) json.RawMessage {
	data, _ := json.Marshal(map[string]string{"type": errorType, "message": message})
	return data
}
