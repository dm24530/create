package handler

import (
	"context"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	middleware "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// SeedanceTasks exposes Ark's native asynchronous video task protocol.
func (h *OpenAIGatewayHandler) SeedanceTasks(c *gin.Context) {
	if c.Request.Method == http.MethodPost && c.GetHeader("Content-Type") != "" {
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || mediaType != "application/json" {
			h.errorResponse(c, http.StatusUnsupportedMediaType, "invalid_request_error", "Seedance requires application/json")
			return
		}
	}
	key, ok := middleware.GetAPIKeyFromContext(c)
	if !ok || key.Group == nil || (key.Group.Platform != service.PlatformOpenAI && key.Group.Platform != service.PlatformComposite) {
		h.errorResponse(c, http.StatusForbidden, "permission_error", "Seedance requires an OpenAI or composite group")
		return
	}
	endpoint := service.SeedanceEndpointCreate
	setActualUpstreamEndpoint(c, EndpointSeedanceTasks)
	taskID := ""
	if c.Request.Method != http.MethodPost {
		taskID = service.SeedanceTaskKey(c.Param("task_id"))
		endpoint = service.SeedanceEndpointStatus
		if c.Request.Method == http.MethodDelete {
			endpoint = service.SeedanceEndpointDelete
		}
	}
	h.handleGrokMedia(c, endpoint, taskID)
}

// Seedance supports two explicit modes: upstream completion-token billing by
// default, or group-configured per-resolution video-second billing. Repeated
// polls share the same durable task dedup key and can bill only once.
func prepareSeedanceCompletionBilling(ctx context.Context, h *OpenAIGatewayHandler, key *service.APIKey, subject middleware.AuthSubject, taskID string, result *service.OpenAIForwardResult) *service.OpenAIForwardResult {
	if h == nil || h.gatewayService == nil || key == nil || result == nil {
		return nil
	}
	taskID = strings.TrimSpace(firstNonEmptyString(taskID, result.ResponseID))
	if taskID == "" {
		return nil
	}
	pending, err := h.gatewayService.LoadGrokVideoPendingBilling(ctx, taskID, subject.UserID, key.ID)
	if err != nil || pending == nil {
		if err != nil {
			logger.L().Warn("seedance.pending_billing_load_failed",
				zap.String("request_id", taskID),
				zap.Error(err),
			)
		}
	}
	billingModel := firstNonEmptyString(result.BillingModel, result.Model)
	if pending != nil {
		billingModel = firstNonEmptyString(pending.BillingModel, pending.Model, billingModel, pending.OriginalModel)
	}
	perSecond := key.Group != nil && key.Group.UsesVideoSecondBilling(billingModel)
	groupPricing := key.Group.ModelPricingFor(billingModel)
	perRequestVideo := groupPricing != nil && groupPricing.BillingMode == service.BillingModePerRequest
	if perSecond {
		// Per-second billing needs the create-time request snapshot because the
		// completed Seedance task may omit duration and resolution.
		if pending == nil {
			logger.L().Warn("seedance.per_second_billing_missing_pending",
				zap.String("request_id", taskID),
				zap.String("model", billingModel),
			)
			return nil
		}
		resolution := service.NormalizeVideoBillingResolutionOrDefault(firstNonEmptyString(result.VideoResolution, pending.VideoResolution))
		if !key.Group.HasConfiguredVideoSecondPrice(billingModel, resolution) {
			logger.L().Warn("seedance.per_second_billing_price_missing",
				zap.String("request_id", taskID),
				zap.String("model", billingModel),
				zap.String("resolution", resolution),
			)
			return nil
		}
	} else if perRequestVideo {
		// Per-call video pricing needs the create snapshot (duration/resolution/
		// reference count) and must not depend on upstream token usage.
		if pending == nil {
			logger.L().Warn("seedance.per_request_billing_missing_pending",
				zap.String("request_id", taskID),
				zap.String("model", billingModel),
			)
			return nil
		}
	} else if result.Usage.OutputTokens <= 0 {
		return nil
	}
	claimed, err := h.gatewayService.ClaimGrokVideoBilling(ctx, taskID, subject.UserID, key.ID)
	if err != nil || !claimed {
		return nil
	}
	merged := *result
	if pending != nil {
		merged.Model = firstNonEmptyString(pending.BillingModel, pending.Model, pending.OriginalModel, merged.Model)
		merged.BillingModel = firstNonEmptyString(pending.BillingModel, pending.Model, merged.BillingModel, merged.Model)
		if strings.TrimSpace(merged.UpstreamModel) == "" {
			merged.UpstreamModel = pending.UpstreamModel
		}
		if strings.TrimSpace(merged.VideoResolution) == "" {
			merged.VideoResolution = pending.VideoResolution
		}
		if merged.VideoDurationSeconds <= 0 {
			merged.VideoDurationSeconds = pending.VideoDurationSeconds
		}
		if merged.VideoReferenceImageCount <= 0 {
			merged.VideoReferenceImageCount = pending.ReferenceImageCount
		}
		if merged.VideoReferenceBillingSeconds <= 0 {
			merged.VideoReferenceBillingSeconds = pending.ReferenceVideoBillingSeconds
		}
	}
	if strings.TrimSpace(merged.Model) == "" {
		merged.Model = firstNonEmptyString(merged.BillingModel, result.Model)
	}
	if strings.TrimSpace(merged.BillingModel) == "" {
		merged.BillingModel = merged.Model
	}
	merged.UpstreamModel = firstNonEmptyString(merged.UpstreamModel, result.UpstreamModel)
	merged.RequestID = service.StableGrokVideoBillingRequestID(taskID)
	merged.ResponseID = taskID
	if perSecond || perRequestVideo {
		merged.Usage.OutputTokens = 0
		merged.VideoCount = 1
		merged.ImageCount = 0
		merged.VideoResolution = service.NormalizeVideoBillingResolutionOrDefault(merged.VideoResolution)
		merged.VideoDurationSeconds = service.NormalizeVideoBillingDurationSecondsForModelOrDefault(merged.BillingModel, merged.VideoDurationSeconds)
	} else {
		merged.VideoCount = 0
	}
	if pending != nil {
		if e2e := service.GrokVideoE2EDuration(pending.CreatedAt, time.Now()); e2e > 0 {
			merged.Duration = e2e
		}
	}
	return &merged
}
