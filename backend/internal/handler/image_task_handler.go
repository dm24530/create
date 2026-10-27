package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	pkghttputil "github.com/Wei-Shaw/sub2api/internal/pkg/httputil"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type AsyncImageHandler struct {
	tasks      *service.ImageTaskService
	openAI     *OpenAIGatewayHandler
	gateway    *GatewayHandler
	apiKeys    imageTaskAPIKeyLoader
	imageLinks service.UsageLogImageLinkStore
	execute    func(platform string, c *gin.Context)
	running    sync.Map
	failureLog sync.Map
}

type imageTaskAPIKeyLoader interface {
	GetByID(ctx context.Context, id int64) (*service.APIKey, error)
}

type imageTaskBillingRefunder interface {
	RefundUsageBilling(context.Context, *service.UsageBillingRefundCommand) (*service.UsageBillingRefundResult, error)
}

const asyncImageGeminiModelKey = "async_image_gemini_model"
const imageTaskLeaseTTL = 2 * time.Minute
const imageTaskLeaseRenewInterval = 30 * time.Second
const imageTaskLeaseRenewTimeout = 5 * time.Second
const imageTaskLeaseRenewFailureLimit = 3
const geminiAsyncImageMaxRequestBodyBytes = 16 << 20
const geminiAsyncImageMaxInlineImages = 14
const geminiAsyncImageMaxInlineBytes = 12 << 20
const geminiAsyncImageMaxSingleInlineBytes = 8 << 20

var errGeminiImageOutputMissing = errors.New("gemini response contained no image output")

type asyncGeminiTaskEnvelope struct {
	Model   string          `json:"model"`
	Request json.RawMessage `json:"request"`
	Stats   geminiImageRequestStats
}

type geminiImageRequestPayload struct {
	Contents []struct {
		Parts []struct {
			InlineData      *geminiImageInlineData `json:"inlineData"`
			InlineDataSnake *geminiImageInlineData `json:"inline_data"`
			FileData        *geminiImageFileData   `json:"fileData"`
			FileDataSnake   *geminiImageFileData   `json:"file_data"`
		} `json:"parts"`
	} `json:"contents"`
}

type geminiImageInlineData struct {
	MIMEType      string `json:"mimeType"`
	MIMETypeSnake string `json:"mime_type"`
	Data          string `json:"data"`
}

type geminiImageFileData struct {
	MIMEType      string `json:"mimeType"`
	MIMETypeSnake string `json:"mime_type"`
	FileURI       string `json:"fileUri"`
	FileURISnake  string `json:"file_uri"`
}

type geminiImageRequestStats struct {
	ImageCount  int
	InlineBytes int
}

func NewAsyncImageHandler(tasks *service.ImageTaskService, openAI *OpenAIGatewayHandler) *AsyncImageHandler {
	h := &AsyncImageHandler{tasks: tasks, openAI: openAI}
	h.execute = h.executeWithGateway
	return h
}

func (h *AsyncImageHandler) Configure(
	gateway *GatewayHandler,
	apiKeys *service.APIKeyService,
	imageLinks service.UsageLogImageLinkStore,
) {
	if h == nil {
		return
	}
	h.gateway = gateway
	h.apiKeys = apiKeys
	h.imageLinks = imageLinks
	go h.recoverPendingLoop()
	go h.cleanupUsageImageLinksLoop()
}

func (h *AsyncImageHandler) cleanupUsageImageLinksLoop() {
	if h == nil || h.imageLinks == nil {
		return
	}
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := h.imageLinks.DeleteExpired(ctx, time.Now(), 500); err != nil {
			logger.L().Warn("usage_log_image_link.cleanup_failed", zap.Error(err))
		}
	}
	cleanup()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		cleanup()
	}
}

// enabled reports whether the async image task feature is available. Object
// storage is the enablement gate: without it the endpoints are fully disabled
// so that large base64 results never land in Redis.
func (h *AsyncImageHandler) enabled() bool {
	return h != nil && h.tasks != nil && h.tasks.Enabled()
}

// pollable reports whether task lookups can be served. It is deliberately weaker
// than enabled(): results already written to Redis stay readable after the
// feature is switched off, so an in-flight task is never stranded.
func (h *AsyncImageHandler) pollable() bool {
	return h != nil && h.tasks != nil && h.tasks.Pollable()
}

// Submit accepts the same payload as the synchronous Images endpoint and
// returns before the upstream image generation begins.
func (h *AsyncImageHandler) Submit(c *gin.Context) {
	if !h.enabled() {
		imageTaskJSONError(c, http.StatusNotFound, "not_found_error", "async image tasks are not enabled")
		return
	}
	apiKey, ok := middleware2.GetAPIKeyFromContext(c)
	if !ok || apiKey == nil || apiKey.UserID <= 0 || apiKey.ID <= 0 {
		imageTaskError(c, service.ErrImageTaskForbidden)
		return
	}
	platform := ""
	if apiKey.Group != nil {
		platform = apiKey.Group.Platform
	}
	if platform != service.PlatformOpenAI &&
		platform != service.PlatformGrok &&
		platform != service.PlatformGemini &&
		platform != service.PlatformAntigravity &&
		platform != service.PlatformComposite {
		imageTaskJSONError(c, http.StatusNotFound, "not_found_error", "Images API is not supported for this platform")
		return
	}

	if !service.GroupAllowsImageGeneration(apiKey.Group) {
		imageTaskJSONError(c, http.StatusForbidden, "permission_error", service.ImageGenerationPermissionMessage())
		return
	}
	if h == nil || h.tasks == nil || h.execute == nil {
		imageTaskError(c, service.ErrImageTaskUnavailable)
		return
	}
	if isGeminiAsyncImagePlatform(platform) && c.Request.ContentLength > geminiAsyncImageMaxRequestBodyBytes {
		imageTaskJSONError(
			c,
			http.StatusRequestEntityTooLarge,
			"invalid_request_error",
			"Gemini image request is too large; reduce the number or resolution of reference images",
		)
		return
	}

	body, err := pkghttputil.ReadRequestBodyWithPrealloc(c.Request)
	if err != nil {
		if maxErr, ok := extractMaxBytesError(err); ok {
			imageTaskJSONError(c, http.StatusRequestEntityTooLarge, "invalid_request_error", buildBodyTooLargeMessage(maxErr.Limit))
			return
		}
		imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", "Failed to read request body")
		return
	}
	if len(body) == 0 {
		imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", "Request body is empty")
		return
	}
	if asyncImageRequestStreams(c.GetHeader("Content-Type"), body) {
		imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", "streaming image requests cannot be submitted as asynchronous tasks")
		return
	}
	effectivePlatform := h.resolveAsyncImagePlatform(c, platform, body)
	if effectivePlatform == "" {
		imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", "model is required for composite image tasks")
		return
	}
	var geminiEnvelope *asyncGeminiTaskEnvelope
	if isGeminiAsyncImagePlatform(effectivePlatform) {
		if len(body) > geminiAsyncImageMaxRequestBodyBytes {
			imageTaskJSONError(
				c,
				http.StatusRequestEntityTooLarge,
				"invalid_request_error",
				"Gemini image request is too large; reduce the number or resolution of reference images",
			)
			return
		}
		geminiEnvelope, err = parseGeminiAsyncEnvelope(body)
		if err != nil {
			imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", err.Error())
			return
		}
		logger.L().Info("image_task.gemini_request_validated",
			zap.String("model", geminiEnvelope.Model),
			zap.Int("body_bytes", len(body)),
			zap.Int("image_count", geminiEnvelope.Stats.ImageCount),
			zap.Int("inline_bytes", geminiEnvelope.Stats.InlineBytes),
		)
	}
	if err := h.validateRequest(c, effectivePlatform, body, geminiEnvelope); err != nil {
		imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	if !h.checkSecurityAuditBeforeSubmit(c, apiKey, effectivePlatform, body, geminiEnvelope) {
		return
	}

	executionBody := body
	if geminiEnvelope != nil {
		executionBody = geminiEnvelope.Request
		c.Set(asyncImageGeminiModelKey, geminiEnvelope.Model)
	}
	taskCtx, recorder, cancel := newAsyncImageContext(c, executionBody, h.tasks.ExecutionTimeout())
	if modelValue, exists := c.Get(asyncImageGeminiModelKey); exists {
		taskCtx.Set(asyncImageGeminiModelKey, modelValue)
	}
	geminiModel := ""
	if modelValue, exists := c.Get(asyncImageGeminiModelKey); exists {
		geminiModel, _ = modelValue.(string)
	}
	requestPath := strings.TrimSuffix(c.Request.URL.Path, "/async")
	task, replayed, err := h.tasks.CreateWithExecutionIdempotent(
		c.Request.Context(),
		service.ImageTaskOwner{UserID: apiKey.UserID, APIKeyID: apiKey.ID},
		&service.ImageTaskExecution{
			Platform:          effectivePlatform,
			RequestPath:       requestPath,
			GeminiModel:       geminiModel,
			ContentType:       c.GetHeader("Content-Type"),
			CompressedBody:    executionBody,
			UsageRequestID:    imageTaskUsageRequestID(c.Request.Context()),
			RequestInstanceID: resolveOpsRequestInstanceID(c.Request.Context()),
		},
		c.GetHeader("Idempotency-Key"),
		service.ImageTaskRequestHash(platform, requestPath, geminiModel, c.GetHeader("Content-Type"), body),
	)
	if err != nil {
		cancel()
		imageTaskError(c, err)
		return
	}
	pollURL := imageTaskPollURL(c.Request.URL.Path, task.ID)
	if replayed {
		cancel()
		c.Header("X-Idempotency-Replayed", "true")
		writeAcceptedImageTask(c, task, pollURL)
		return
	}
	claimed, claimErr := h.tasks.Claim(c.Request.Context(), task.ID, imageTaskLeaseTTL)
	if claimErr != nil || !claimed {
		cancel()
		imageTaskError(c, service.ErrImageTaskUnavailable)
		return
	}

	writeAcceptedImageTask(c, task, pollURL)

	go h.run(task.ID, effectivePlatform, taskCtx, recorder, cancel)
}

func (h *AsyncImageHandler) resolveAsyncImagePlatform(c *gin.Context, platform string, body []byte) string {
	if platform != service.PlatformComposite {
		return platform
	}
	model := ""
	var payload struct {
		Model string `json:"model"`
	}
	if json.Unmarshal(body, &payload) == nil {
		model = strings.TrimSpace(payload.Model)
	}
	if model == "" && h != nil && h.openAI != nil && h.openAI.gatewayService != nil {
		if parsed, err := h.openAI.gatewayService.ParseOpenAIImagesRequest(c, body); err == nil {
			model = strings.TrimSpace(parsed.Model)
		}
	}
	if resolved, ok := service.DetectModelPlatform(model); ok {
		return resolved
	}
	return ""
}

func writeAcceptedImageTask(c *gin.Context, task *service.ImageTask, pollURL string) {
	c.Header("Cache-Control", "no-store")
	c.Header("Location", pollURL)
	c.Header("Retry-After", "3")
	c.JSON(http.StatusAccepted, gin.H{
		"id":         task.ID,
		"task_id":    task.TaskID,
		"object":     task.Object,
		"status":     task.Status,
		"created_at": task.CreatedAt,
		"expires_at": task.ExpiresAt,
		"poll_url":   pollURL,
	})
}

func (h *AsyncImageHandler) checkSecurityAuditBeforeSubmit(
	c *gin.Context,
	apiKey *service.APIKey,
	platform string,
	body []byte,
	geminiEnvelope *asyncGeminiTaskEnvelope,
) bool {
	if h == nil || h.openAI == nil {
		return true
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		imageTaskJSONError(c, http.StatusInternalServerError, "api_error", "User context not found")
		return false
	}
	model := ""
	moderationBody := body
	if platform == service.PlatformGrok {
		parsed := service.ParseGrokMediaRequest(c.GetHeader("Content-Type"), body)
		model, moderationBody = parsed.Model, parsed.ModerationBody()
	} else if isGeminiAsyncImagePlatform(platform) {
		if geminiEnvelope == nil {
			parsed, err := parseGeminiAsyncEnvelope(body)
			if err != nil {
				imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", err.Error())
				return false
			}
			geminiEnvelope = parsed
		}
		model = geminiEnvelope.Model
		moderationBody = extractGeminiPromptBody(geminiEnvelope.Request)
	} else if h.openAI.gatewayService != nil {
		parsed, err := h.openAI.gatewayService.ParseOpenAIImagesRequest(c, body)
		if err != nil {
			imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", err.Error())
			return false
		}
		model, moderationBody = parsed.Model, parsed.ModerationBody()
	}
	if len(moderationBody) == 0 {
		c.Set(securityAuditCompletedContextKey, true)
		return true
	}
	reqLog := requestLogger(c, "handler.async_image.security_audit",
		zap.Int64("user_id", subject.UserID), zap.Int64("api_key_id", apiKey.ID), zap.String("model", model))
	protocol := service.ContentModerationProtocolOpenAIImages
	if isGeminiAsyncImagePlatform(platform) {
		protocol = service.ContentModerationProtocolGemini
	}
	decision := h.openAI.checkSecurityAudit(c, reqLog, apiKey, subject, protocol, model, moderationBody)
	if decision != nil && !decision.AllowNextStage {
		h.openAI.openAISecurityAuditError(c, decision)
		return false
	}
	return true
}

func (h *AsyncImageHandler) Get(c *gin.Context) {
	// Polling deliberately does not require the feature to be enabled, only that
	// the task store is reachable. Turning the switch off in the admin UI must not
	// strand tasks that were already accepted — their results are still in Redis
	// and their submitters are still polling.
	if !h.pollable() {
		imageTaskJSONError(c, http.StatusNotFound, "not_found_error", "async image tasks are not enabled")
		return
	}
	apiKey, ok := middleware2.GetAPIKeyFromContext(c)
	if !ok || apiKey == nil || apiKey.UserID <= 0 || apiKey.ID <= 0 {
		imageTaskError(c, service.ErrImageTaskForbidden)
		return
	}
	task, err := h.tasks.Get(c.Request.Context(), service.ImageTaskOwner{UserID: apiKey.UserID, APIKeyID: apiKey.ID}, c.Param("task_id"))
	if err != nil {
		imageTaskError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	if task.Status == service.ImageTaskStatusProcessing || task.Status == service.ImageTaskStatusPreviewReady {
		c.Header("Retry-After", "3")
	}
	c.JSON(http.StatusOK, task)
}

func (h *AsyncImageHandler) validateRequest(c *gin.Context, platform string, body []byte, geminiEnvelope *asyncGeminiTaskEnvelope) error {
	if h.openAI == nil || h.openAI.gatewayService == nil {
		return nil
	}
	if platform == service.PlatformGrok {
		parsed := service.ParseGrokMediaRequest(c.GetHeader("Content-Type"), body)
		if strings.TrimSpace(parsed.Model) == "" {
			return errors.New("model is required")
		}
		return nil
	}
	if isGeminiAsyncImagePlatform(platform) {
		if geminiEnvelope != nil {
			return nil
		}
		_, err := parseGeminiAsyncEnvelope(body)
		return err
	}
	parsed, err := h.openAI.gatewayService.ParseOpenAIImagesRequest(c, body)
	if err != nil {
		return err
	}
	if parsed.Stream {
		return errors.New("streaming image requests cannot be submitted as asynchronous tasks")
	}
	return nil
}

func (h *AsyncImageHandler) executeWithGateway(platform string, c *gin.Context) {
	if h.openAI == nil {
		imageTaskJSONError(c, http.StatusServiceUnavailable, "api_error", "image gateway is unavailable")
		return
	}
	if platform == service.PlatformGrok {
		h.openAI.GrokImages(c)
		return
	}
	if isGeminiAsyncImagePlatform(platform) {
		h.executeGemini(c, platform)
		return
	}
	h.openAI.Images(c)
}

func (h *AsyncImageHandler) executeGemini(c *gin.Context, platform string) {
	if h.gateway == nil {
		imageTaskJSONError(c, http.StatusServiceUnavailable, "api_error", "Gemini gateway is unavailable")
		return
	}
	modelValue, exists := c.Get(asyncImageGeminiModelKey)
	model, _ := modelValue.(string)
	if !exists || strings.TrimSpace(model) == "" {
		imageTaskJSONError(c, http.StatusBadRequest, "invalid_request_error", "model is required")
		return
	}
	prefix := "/v1beta"
	if platform == service.PlatformAntigravity {
		prefix = "/antigravity/v1beta"
		c.Set(string(middleware2.ContextKeyForcePlatform), service.PlatformAntigravity)
		c.Request = c.Request.WithContext(context.WithValue(
			c.Request.Context(),
			ctxkey.ForcePlatform,
			service.PlatformAntigravity,
		))
	}
	c.Params = gin.Params{{
		Key:   "modelAction",
		Value: strings.TrimSpace(model) + ":generateContent",
	}}
	c.Request.URL.Path = prefix + "/models/" + strings.TrimSpace(model) + ":generateContent"
	h.gateway.GeminiV1BetaModels(c)
}

func (h *AsyncImageHandler) recoverPendingLoop() {
	if h == nil || h.tasks == nil {
		return
	}
	h.recoverPending()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		h.recoverPending()
	}
}

func (h *AsyncImageHandler) recoverPending() {
	ctx := context.Background()
	tasks, err := h.tasks.ListPending(ctx, 100)
	if err != nil {
		logger.L().Warn("image_task.recovery_list_failed", zap.Error(err))
		return
	}
	for _, task := range tasks {
		if task == nil {
			continue
		}
		if _, running := h.running.Load(task.ID); running {
			continue
		}
		claimed, claimErr := h.tasks.Claim(ctx, task.ID, imageTaskLeaseTTL)
		if claimErr != nil || !claimed {
			continue
		}
		if task.Execution == nil {
			h.failTask(task.ID, http.StatusServiceUnavailable, imageTaskErrorPayload("api_error", "image task cannot be resumed after restart"))
			_ = h.tasks.ReleaseClaim(ctx, task.ID)
			continue
		}
		if task.StartedAt > 0 {
			h.failTask(task.ID, http.StatusServiceUnavailable, imageTaskErrorPayload(
				"api_error",
				"image task execution was interrupted; the upstream result cannot be confirmed safely",
			))
			_ = h.tasks.ReleaseClaim(ctx, task.ID)
			continue
		}
		taskCtx, recorder, cancel, err := h.contextFromTask(task)
		if err != nil {
			cancel()
			h.failTask(task.ID, http.StatusServiceUnavailable, imageTaskErrorPayload("api_error", err.Error()))
			_ = h.tasks.ReleaseClaim(ctx, task.ID)
			continue
		}
		go h.run(task.ID, task.Execution.Platform, taskCtx, recorder, cancel)
	}
}

func (h *AsyncImageHandler) contextFromTask(task *service.ImageTaskRecord) (*gin.Context, *httptest.ResponseRecorder, context.CancelFunc, error) {
	if h.apiKeys == nil {
		return nil, nil, func() {}, errors.New("image task API key service is unavailable")
	}
	apiKey, err := h.apiKeys.GetByID(context.Background(), task.APIKeyID)
	if err != nil || apiKey == nil {
		return nil, nil, func() {}, errors.New("image task API key is no longer available")
	}
	ctx, cancel := context.WithTimeout(context.Background(), h.tasks.ExecutionTimeout())
	return newImageTaskContext(task, apiKey, ctx, cancel)
}

func newImageTaskContext(
	task *service.ImageTaskRecord,
	apiKey *service.APIKey,
	ctx context.Context,
	cancel context.CancelFunc,
) (*gin.Context, *httptest.ResponseRecorder, context.CancelFunc, error) {
	if task == nil || task.Execution == nil {
		cancel()
		return nil, nil, func() {}, errors.New("image task execution is unavailable")
	}
	if apiKey == nil {
		cancel()
		return nil, nil, func() {}, errors.New("image task API key is unavailable")
	}
	body, err := task.Execution.DecompressedBody()
	if err != nil {
		cancel()
		return nil, nil, func() {}, errors.New("image task request body is corrupted")
	}
	path := strings.TrimSpace(task.Execution.RequestPath)
	if path == "" {
		path = "/v1/images/generations"
		if task.Execution.Platform == service.PlatformGemini || task.Execution.Platform == service.PlatformAntigravity {
			path = "/v1beta/models/" + task.Execution.GeminiModel + ":generateContent"
		}
	}
	ctx = context.WithValue(ctx, ctxkey.AsyncImageTask, true)
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body)).WithContext(ctx)
	request = request.WithContext(withImageTaskUsageRequestID(request.Context(), task.Execution.UsageRequestID))
	request = request.WithContext(service.WithUsageBillingRequestID(request.Context(), task.Execution.UsageRequestID))
	request.Header.Set("Authorization", "Bearer "+apiKey.Key)
	if task.Execution.ContentType != "" {
		request.Header.Set("Content-Type", task.Execution.ContentType)
	}
	recorder := httptest.NewRecorder()
	base, _ := gin.CreateTestContext(recorder)
	base.Request = request
	base.Set(string(middleware2.ContextKeyAPIKey), apiKey)
	base.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: apiKey.UserID})
	if task.Execution.Platform == service.PlatformAntigravity {
		base.Set(string(middleware2.ContextKeyForcePlatform), service.PlatformAntigravity)
		base.Request = base.Request.WithContext(context.WithValue(
			base.Request.Context(),
			ctxkey.ForcePlatform,
			service.PlatformAntigravity,
		))
	}
	if task.Execution.GeminiModel != "" {
		base.Set(asyncImageGeminiModelKey, task.Execution.GeminiModel)
	}
	return base, recorder, cancel, nil
}

func (h *AsyncImageHandler) run(taskID, platform string, taskCtx *gin.Context, recorder *httptest.ResponseRecorder, cancel context.CancelFunc) {
	if _, loaded := h.running.LoadOrStore(taskID, struct{}{}); loaded {
		cancel()
		return
	}
	defer cancel()
	defer h.running.Delete(taskID)
	defer func() { _ = h.tasks.ReleaseClaim(context.Background(), taskID) }()
	stopHeartbeat := make(chan struct{})
	defer close(stopHeartbeat)
	var leaseLost atomic.Bool
	go func() {
		ticker := time.NewTicker(imageTaskLeaseRenewInterval)
		defer ticker.Stop()
		consecutiveFailures := 0
		for {
			select {
			case <-stopHeartbeat:
				return
			case <-ticker.C:
				renewCtx, renewCancel := context.WithTimeout(context.Background(), imageTaskLeaseRenewTimeout)
				renewed, err := h.tasks.RenewClaim(renewCtx, taskID, imageTaskLeaseTTL)
				renewCancel()
				if renewed {
					consecutiveFailures = 0
					continue
				}
				if err == nil {
					// The lease belongs to another worker. Continuing would risk
					// duplicate upstream execution and billing.
					leaseLost.Store(true)
					cancel()
					return
				}
				consecutiveFailures++
				logger.L().Warn("image_task.lease_renew_failed",
					zap.String("task_id", taskID),
					zap.Int("consecutive_failures", consecutiveFailures),
					zap.Error(err))
				if consecutiveFailures >= imageTaskLeaseRenewFailureLimit {
					leaseLost.Store(true)
					cancel()
					return
				}
			}
		}
	}()
	defer func() {
		if recovered := recover(); recovered != nil {
			logger.L().Error("image_task.execution_panicked", zap.String("task_id", taskID), zap.Any("panic", recovered))
			if h.renewTaskLease(taskID) {
				h.failTask(taskID, http.StatusInternalServerError, imageTaskErrorPayload("api_error", "image generation task panicked"))
			}
		}
	}()

	if err := h.tasks.MarkStarted(context.Background(), taskID); err != nil {
		logger.L().Warn("image_task.mark_started_failed", zap.String("task_id", taskID), zap.Error(err))
		return
	}
	usageRequestID := imageTaskUsageRequestID(taskCtx.Request.Context())
	h.execute(platform, taskCtx)
	attemptCtxErr := taskCtx.Request.Context().Err()
	if leaseLost.Load() {
		// Another worker may own the task now; never let this stale execution
		// overwrite the authoritative result.
		return
	}
	if !h.renewTaskLease(taskID) {
		leaseLost.Store(true)
		return
	}
	body := bytes.TrimSpace(recorder.Body.Bytes())
	if isGeminiAsyncImagePlatform(platform) {
		normalized, normalizeErr := normalizeGeminiImageTaskResult(body)
		if normalizeErr != nil {
			statusCode := recorder.Code
			if statusCode == 0 {
				statusCode = http.StatusOK
			}
			preview := strings.Join(strings.Fields(string(body)), " ")
			if len(preview) > 300 {
				preview = preview[:300]
			}
			logger.L().Warn("image_task.gemini_invalid_response",
				zap.String("task_id", taskID),
				zap.Int("status_code", statusCode),
				zap.String("content_type", recorder.Header().Get("Content-Type")),
				zap.Int("body_bytes", len(body)),
				zap.String("body_preview", preview),
				zap.Error(normalizeErr),
			)
			var message string
			if errors.Is(normalizeErr, errGeminiImageOutputMissing) {
				message = "Gemini image upstream returned no image output"
			} else if statusCode == http.StatusRequestEntityTooLarge {
				message = "Gemini image request is too large; retry with fewer or smaller reference images"
			} else if len(body) == 0 {
				message = "Gemini image upstream returned an empty response"
			} else {
				message = "Gemini image upstream returned a non-JSON response"
			}
			h.failTask(taskID, http.StatusBadGateway, imageTaskErrorPayload("api_error", message))
			return
		}
		body = normalized
	}
	if attemptCtxErr != nil && len(body) == 0 {
		h.failTask(taskID, http.StatusGatewayTimeout, imageTaskErrorPayload("timeout_error", "image generation task timed out"))
		return
	}
	statusCode := recorder.Code
	if statusCode == 0 {
		statusCode = http.StatusOK
	}
	if statusCode >= http.StatusOK && statusCode < http.StatusMultipleChoices {
		if isGeminiAsyncImagePlatform(platform) && geminiImageTaskResponseHasError(body) {
			h.failTask(taskID, http.StatusBadGateway, extractImageTaskError(body))
			return
		}
		if len(body) == 0 || !json.Valid(body) {
			h.failTask(taskID, http.StatusBadGateway, imageTaskErrorPayload("api_error", "upstream returned an invalid image response"))
			return
		}
		if err := h.tasks.Complete(context.Background(), taskID, statusCode, json.RawMessage(body)); err != nil {
			logger.L().Error("image_task.complete_store_failed", zap.String("task_id", taskID), zap.Error(err))
			return
		}
		h.recordUsageImageLink(taskID, usageRequestID)
		return
	}
	h.failTask(taskID, statusCode, extractImageTaskError(body))
}

func imageTaskUsageRequestID(ctx context.Context) string {
	if ctx != nil {
		if value, _ := ctx.Value(ctxkey.ClientRequestID).(string); strings.TrimSpace(value) != "" {
			return "client:" + strings.TrimSpace(value)
		}
		if value, _ := ctx.Value(ctxkey.RequestID).(string); strings.TrimSpace(value) != "" {
			return "local:" + strings.TrimSpace(value)
		}
	}
	return ""
}

func withImageTaskUsageRequestID(ctx context.Context, requestID string) context.Context {
	requestID = strings.TrimSpace(requestID)
	switch {
	case strings.HasPrefix(requestID, "client:"):
		return context.WithValue(ctx, ctxkey.ClientRequestID, strings.TrimPrefix(requestID, "client:"))
	case strings.HasPrefix(requestID, "local:"):
		return context.WithValue(ctx, ctxkey.RequestID, strings.TrimPrefix(requestID, "local:"))
	default:
		return ctx
	}
}

func isAsyncImageTaskContext(ctx context.Context) bool {
	async, _ := ctx.Value(ctxkey.AsyncImageTask).(bool)
	return async
}

func (h *AsyncImageHandler) recordUsageImageLink(taskID, usageRequestID string) {
	if h == nil || h.imageLinks == nil || strings.TrimSpace(usageRequestID) == "" {
		return
	}
	task, err := h.tasks.GetRecord(context.Background(), taskID)
	if err != nil {
		logger.L().Warn("image_task.usage_link_record_missing", zap.String("task_id", taskID), zap.Error(err))
		return
	}
	imageURL := firstImageTaskResultURL(task.Result)
	if imageURL == "" {
		return
	}
	if previewURL := firstImageTaskResultPreviewURL(task.Result); previewURL != "" {
		imageURL = previewURL
	}
	objectKey := firstImageTaskResultObjectKey(task.Result)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.imageLinks.Upsert(ctx, &service.UsageLogImageLink{
		UserID:    task.UserID,
		APIKeyID:  task.APIKeyID,
		RequestID: usageRequestID,
		ImageURL:  imageURL,
		ObjectKey: objectKey,
	}); err != nil {
		logger.L().Warn("image_task.usage_link_store_failed",
			zap.String("task_id", taskID),
			zap.String("request_id", usageRequestID),
			zap.Error(err))
	}
}

func firstImageTaskResultURL(result json.RawMessage) string {
	var payload struct {
		URL      string `json:"url"`
		ImageURL string `json:"image_url"`
		Data     []struct {
			URL      string `json:"url"`
			ImageURL string `json:"image_url"`
		} `json:"data"`
	}
	if len(result) == 0 || json.Unmarshal(result, &payload) != nil {
		return ""
	}
	for _, candidate := range []string{payload.URL, payload.ImageURL} {
		if value := strings.TrimSpace(candidate); value != "" {
			return value
		}
	}
	for _, item := range payload.Data {
		for _, candidate := range []string{item.URL, item.ImageURL} {
			if value := strings.TrimSpace(candidate); value != "" {
				return value
			}
		}
	}
	return ""
}

func firstImageTaskResultPreviewURL(result json.RawMessage) string {
	var payload struct {
		PreviewDataURL string `json:"preview_data_url"`
		PreviewURL     string `json:"preview_url"`
		Data           []struct {
			PreviewDataURL string `json:"preview_data_url"`
			PreviewURL     string `json:"preview_url"`
		} `json:"data"`
	}
	if len(result) == 0 || json.Unmarshal(result, &payload) != nil {
		return ""
	}
	candidates := []string{payload.PreviewDataURL, payload.PreviewURL}
	if len(payload.Data) > 0 {
		candidates = append(candidates, payload.Data[0].PreviewDataURL, payload.Data[0].PreviewURL)
	}
	for _, candidate := range candidates {
		if value := strings.TrimSpace(candidate); strings.HasPrefix(value, "data:image/") ||
			strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
			return value
		}
	}
	return ""
}

func firstImageTaskResultObjectKey(result json.RawMessage) string {
	var payload struct {
		ObjectKey string `json:"object_key"`
		Data      []struct {
			ObjectKey string `json:"object_key"`
		} `json:"data"`
	}
	if len(result) == 0 || json.Unmarshal(result, &payload) != nil {
		return ""
	}
	if value := strings.TrimSpace(payload.ObjectKey); value != "" {
		return value
	}
	for _, item := range payload.Data {
		if value := strings.TrimSpace(item.ObjectKey); value != "" {
			return value
		}
	}
	return ""
}

func (h *AsyncImageHandler) renewTaskLease(taskID string) bool {
	for attempt := 0; attempt < imageTaskLeaseRenewFailureLimit; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), imageTaskLeaseRenewTimeout)
		renewed, err := h.tasks.RenewClaim(ctx, taskID, imageTaskLeaseTTL)
		cancel()
		if renewed {
			return true
		}
		if err == nil {
			return false
		}
		if attempt+1 < imageTaskLeaseRenewFailureLimit {
			time.Sleep(200 * time.Millisecond)
		}
	}
	return false
}

func isGeminiAsyncImagePlatform(platform string) bool {
	return platform == service.PlatformGemini || platform == service.PlatformAntigravity
}

func parseGeminiAsyncEnvelope(body []byte) (*asyncGeminiTaskEnvelope, error) {
	var envelope asyncGeminiTaskEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, errors.New("invalid Gemini image task request")
	}
	envelope.Model = strings.TrimSpace(envelope.Model)
	if envelope.Model == "" || !service.IsSafeGeminiModelPathSegment(envelope.Model) {
		return nil, errors.New("valid model is required")
	}
	if len(envelope.Request) == 0 || !json.Valid(envelope.Request) {
		return nil, errors.New("request is required")
	}
	stats, err := inspectGeminiImageRequest(envelope.Request)
	if err != nil {
		return nil, err
	}
	envelope.Stats = stats
	return &envelope, nil
}

func inspectGeminiImageRequest(body []byte) (geminiImageRequestStats, error) {
	var payload geminiImageRequestPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return geminiImageRequestStats{}, errors.New("invalid Gemini image request payload")
	}

	stats := geminiImageRequestStats{}
	for _, content := range payload.Contents {
		for _, part := range content.Parts {
			inline := part.InlineData
			if inline == nil {
				inline = part.InlineDataSnake
			}
			if inline != nil {
				stats.ImageCount++
				mimeType := firstNonEmptyHandlerString(inline.MIMEType, inline.MIMETypeSnake)
				if mimeType == "" || !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
					return stats, errors.New("gemini image parts require an image MIME type")
				}
				if strings.TrimSpace(inline.Data) == "" {
					return stats, errors.New("gemini image part data is required")
				}
				decodedBytes := (len(inline.Data) * 3) / 4
				if decodedBytes > geminiAsyncImageMaxSingleInlineBytes {
					return stats, fmt.Errorf("gemini image part exceeds %d MB", geminiAsyncImageMaxSingleInlineBytes>>20)
				}
				stats.InlineBytes += decodedBytes
				continue
			}

			file := part.FileData
			if file == nil {
				file = part.FileDataSnake
			}
			if file == nil {
				continue
			}
			stats.ImageCount++
			mimeType := firstNonEmptyHandlerString(file.MIMEType, file.MIMETypeSnake)
			if mimeType == "" || !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
				return stats, errors.New("gemini image parts require an image MIME type")
			}
			if firstNonEmptyHandlerString(file.FileURI, file.FileURISnake) == "" {
				return stats, errors.New("gemini file image URI is required")
			}
		}
	}

	if stats.ImageCount > geminiAsyncImageMaxInlineImages {
		return stats, fmt.Errorf("gemini image request supports at most %d images", geminiAsyncImageMaxInlineImages)
	}
	if stats.InlineBytes > geminiAsyncImageMaxInlineBytes {
		return stats, fmt.Errorf("gemini inline images exceed %d MB in total", geminiAsyncImageMaxInlineBytes>>20)
	}
	return stats, nil
}

func firstNonEmptyHandlerString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func geminiImageTaskResponseHasError(body []byte) bool {
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return false
	}
	trimmed := strings.TrimSpace(string(envelope.Error))
	return trimmed != "" && trimmed != "null"
}

func extractGeminiPromptBody(body []byte) json.RawMessage {
	var payload struct {
		Contents []struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"contents"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return nil
	}
	var texts []string
	for _, content := range payload.Contents {
		for _, part := range content.Parts {
			if text := strings.TrimSpace(part.Text); text != "" {
				texts = append(texts, text)
			}
		}
	}
	if len(texts) == 0 {
		return nil
	}
	result, _ := json.Marshal(map[string]string{"prompt": strings.Join(texts, "\n")})
	return result
}

func normalizeGeminiImageTaskResult(body []byte) ([]byte, error) {
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Error) > 0 {
		return body, nil
	}
	items := make([]map[string]string, 0)
	for _, output := range service.ExtractGeminiImageOutputs(body) {
		item := map[string]string{"mime_type": output.MIMEType}
		if output.Base64 != "" {
			item["b64_json"] = output.Base64
		} else if output.URL != "" {
			item["url"] = output.URL
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return nil, errGeminiImageOutputMissing
	}
	return json.Marshal(map[string]any{
		"created": time.Now().UTC().Unix(),
		"data":    items,
	})
}

func (h *AsyncImageHandler) failTask(taskID string, statusCode int, taskErr json.RawMessage) {
	if err := h.tasks.Fail(context.Background(), taskID, statusCode, taskErr); err != nil {
		logger.L().Error("image_task.failure_store_failed", zap.String("task_id", taskID), zap.Error(err))
	}
	if _, loaded := h.failureLog.LoadOrStore(taskID, struct{}{}); !loaded {
		h.recordAsyncTaskFailure(taskID, statusCode, taskErr)
	}
	h.refundFailedImageTask(taskID)
}

func (h *AsyncImageHandler) recordAsyncTaskFailure(taskID string, statusCode int, taskErr json.RawMessage) {
	if h == nil || h.tasks == nil || h.openAI == nil || h.openAI.opsService == nil {
		return
	}
	record, err := h.tasks.GetRecord(context.Background(), taskID)
	if err != nil || record == nil {
		return
	}
	entry := buildAsyncTaskFailureEntry(record, statusCode, taskErr)
	if entry == nil {
		return
	}
	enqueueOpsErrorLog(h.openAI.opsService, entry)
}

func buildAsyncTaskFailureEntry(
	record *service.ImageTaskRecord,
	statusCode int,
	taskErr json.RawMessage,
) *service.OpsInsertErrorLogInput {
	if record == nil {
		return nil
	}
	usageRequestID := ""
	if record.Execution != nil {
		usageRequestID = strings.TrimSpace(record.Execution.UsageRequestID)
	}
	rawRequestID := usageRequestID
	clientRequestID := ""
	switch {
	case strings.HasPrefix(rawRequestID, "client:"):
		clientRequestID = strings.TrimPrefix(rawRequestID, "client:")
		rawRequestID = clientRequestID
	case strings.HasPrefix(rawRequestID, "local:"):
		rawRequestID = strings.TrimPrefix(rawRequestID, "local:")
	}
	errorType, errorMessage := imageTaskFailureDetails(taskErr)
	userID := record.UserID
	apiKeyID := record.APIKeyID
	requestType := int16(service.RequestTypeAsync)
	return &service.OpsInsertErrorLogInput{
		RequestID:         rawRequestID,
		ClientRequestID:   clientRequestID,
		UsageRequestID:    usageRequestID,
		RequestInstanceID: imageTaskRequestInstanceID(record),
		UserID:            &userID,
		APIKeyID:          &apiKeyID,
		RequestPath:       imageTaskRequestPath(record),
		InboundEndpoint:   imageTaskRequestPath(record),
		Platform:          imageTaskPlatform(record),
		Model:             imageTaskModel(record),
		RequestedModel:    imageTaskModel(record),
		RequestType:       &requestType,
		ErrorPhase:        "request",
		ErrorType:         errorType,
		Severity:          "P2",
		StatusCode:        statusCode,
		ErrorMessage:      errorMessage,
		ErrorSource:       "gateway",
		ErrorOwner:        "provider",
		CreatedAt:         time.Now().UTC(),
	}
}

func imageTaskFailureDetails(taskErr json.RawMessage) (string, string) {
	var payload struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	}
	if len(taskErr) > 0 && json.Unmarshal(taskErr, &payload) == nil {
		errorType := strings.TrimSpace(payload.Type)
		if errorType == "" {
			errorType = "api_error"
		}
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = "image generation failed"
		}
		return errorType, message
	}
	return "api_error", "image generation failed"
}

func imageTaskRequestPath(record *service.ImageTaskRecord) string {
	if record != nil && record.Execution != nil && strings.TrimSpace(record.Execution.RequestPath) != "" {
		return strings.TrimSpace(record.Execution.RequestPath)
	}
	return "/v1/images/generations"
}

func imageTaskPlatform(record *service.ImageTaskRecord) string {
	if record != nil && record.Execution != nil {
		return strings.TrimSpace(record.Execution.Platform)
	}
	return ""
}

func imageTaskModel(record *service.ImageTaskRecord) string {
	if record != nil && record.Execution != nil {
		return strings.TrimSpace(record.Execution.GeminiModel)
	}
	return ""
}

func imageTaskRequestInstanceID(record *service.ImageTaskRecord) string {
	if record != nil && record.Execution != nil {
		return strings.TrimSpace(record.Execution.RequestInstanceID)
	}
	return ""
}

func (h *AsyncImageHandler) refundFailedImageTask(taskID string) {
	if h == nil || h.tasks == nil {
		return
	}
	record, err := h.tasks.GetRecord(context.Background(), taskID)
	if err != nil || record == nil || record.Execution == nil {
		return
	}
	if record.RefundStatus == "refunded" || record.APIKeyID <= 0 {
		return
	}
	gatewayService := h.imageTaskGatewayService()
	usageRequestID := strings.TrimSpace(record.Execution.UsageRequestID)
	requestInstanceID := strings.TrimSpace(record.Execution.RequestInstanceID)
	if gatewayService == nil || usageRequestID == "" {
		return
	}

	apiKeyID := record.APIKeyID
	go func() {
		for _, delay := range []time.Duration{0, 2 * time.Second, 5 * time.Second, 10 * time.Second, 30 * time.Second} {
			if delay > 0 {
				time.Sleep(delay)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			result, refundErr := gatewayService.RefundUsageBilling(ctx, &service.UsageBillingRefundCommand{
				RequestID:         usageRequestID,
				RequestInstanceID: requestInstanceID,
				APIKeyID:          apiKeyID,
				Reason:            "async_image_task_failed",
			})
			cancel()
			if refundErr != nil {
				logger.L().Warn("image_task.refund_failed",
					zap.String("task_id", taskID),
					zap.String("request_id", usageRequestID),
					zap.Error(refundErr),
				)
				continue
			}
			if result == nil || (!result.Applied && !result.AlreadyRefunded) {
				continue
			}
			if markErr := h.tasks.MarkRefunded(context.Background(), taskID, result.RefundedAmount, result.RefundedAt); markErr != nil {
				logger.L().Warn("image_task.refund_mark_failed",
					zap.String("task_id", taskID),
					zap.Error(markErr),
				)
				continue
			}
			return
		}
	}()
}

func (h *AsyncImageHandler) imageTaskGatewayService() imageTaskBillingRefunder {
	if h == nil {
		return nil
	}
	if h.openAI != nil && h.openAI.gatewayService != nil {
		return h.openAI.gatewayService
	}
	if h.gateway != nil {
		return h.gateway.gatewayService
	}
	return nil
}

func newAsyncImageContext(c *gin.Context, body []byte, timeoutDuration time.Duration) (*gin.Context, *httptest.ResponseRecorder, context.CancelFunc) {
	base := context.WithValue(context.WithoutCancel(c.Request.Context()), ctxkey.AsyncImageTask, true)
	executionCtx, cancel := context.WithTimeout(base, timeoutDuration)
	request := c.Request.Clone(executionCtx)
	request.Body = io.NopCloser(bytes.NewReader(body))
	request.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
	request.ContentLength = int64(len(body))
	request.URL.Path = strings.TrimSuffix(request.URL.Path, "/async")

	taskCtx := c.Copy()
	recorder := httptest.NewRecorder()
	recorderCtx, _ := gin.CreateTestContext(recorder)
	taskCtx.Writer = recorderCtx.Writer
	taskCtx.Request = request
	return taskCtx, recorder, cancel
}

func asyncImageRequestStreams(contentType string, body []byte) bool {
	if isMultipartImagesContentType(contentType) {
		return false
	}
	var envelope struct {
		Stream bool `json:"stream"`
	}
	return json.Unmarshal(body, &envelope) == nil && envelope.Stream
}

func imageTaskPollURL(submitPath, taskID string) string {
	if strings.HasPrefix(submitPath, "/v1/") {
		return "/v1/images/tasks/" + taskID
	}
	return "/images/tasks/" + taskID
}

func extractImageTaskError(body []byte) json.RawMessage {
	if json.Valid(body) {
		var envelope struct {
			Error json.RawMessage `json:"error"`
		}
		if json.Unmarshal(body, &envelope) == nil && len(envelope.Error) > 0 && json.Valid(envelope.Error) {
			return envelope.Error
		}
		return json.RawMessage(body)
	}
	return imageTaskErrorPayload("api_error", "image generation failed")
}

func imageTaskErrorPayload(errorType, message string) json.RawMessage {
	data, _ := json.Marshal(gin.H{"type": errorType, "message": message})
	return data
}

func imageTaskError(c *gin.Context, err error) {
	status := infraerrors.Code(err)
	code := infraerrors.Reason(err)
	message := infraerrors.Message(err)
	if status <= 0 {
		status = http.StatusInternalServerError
	}
	if strings.TrimSpace(code) == "" {
		code = "IMAGE_TASK_ERROR"
	}
	imageTaskJSONError(c, status, code, message)
}

func imageTaskJSONError(c *gin.Context, status int, code, message string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"error": gin.H{"type": code, "code": code, "message": message}})
}
