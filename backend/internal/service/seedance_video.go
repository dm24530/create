package service

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	SeedanceVideoEndpointCreate  GrokMediaEndpoint = "seedance_video_create"
	SeedanceVideoEndpointStatus  GrokMediaEndpoint = "seedance_video_status"
	SeedanceVideoEndpointContent GrokMediaEndpoint = "seedance_video_content"
)

func (e GrokMediaEndpoint) IsSeedanceVideo() bool {
	return e == SeedanceVideoEndpointCreate ||
		e == SeedanceVideoEndpointStatus ||
		e == SeedanceVideoEndpointContent
}

func buildSeedanceVideoURL(base string, endpoint GrokMediaEndpoint, taskID string) (string, error) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return "", fmt.Errorf("video base URL is required")
	}
	if !strings.HasSuffix(base, "/v1") {
		base += "/v1"
	}
	switch endpoint {
	case SeedanceVideoEndpointCreate:
		return base + "/video/generations", nil
	case SeedanceVideoEndpointStatus:
		if err := validateUpstreamPathSegment("video task ID", taskID); err != nil || strings.TrimSpace(taskID) == "" {
			return "", fmt.Errorf("invalid video task ID")
		}
		return base + "/videos/" + taskID, nil
	case SeedanceVideoEndpointContent:
		if err := validateUpstreamPathSegment("video task ID", taskID); err != nil || strings.TrimSpace(taskID) == "" {
			return "", fmt.Errorf("invalid video task ID")
		}
		return base + "/videos/" + taskID + "/content", nil
	default:
		return "", fmt.Errorf("unsupported video endpoint: %s", endpoint)
	}
}

// ForwardSeedanceVideo forwards OpenAI-compatible video requests while
// preserving the documented request body except for account model mapping.
func (s *OpenAIGatewayService) ForwardSeedanceVideo(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	endpoint GrokMediaEndpoint,
	taskID string,
	body []byte,
) (*OpenAIForwardResult, error) {
	return s.forwardSeedanceVideo(ctx, c, account, endpoint, taskID, body, false)
}

func (s *OpenAIGatewayService) forwardSeedanceVideo(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	endpoint GrokMediaEndpoint,
	taskID string,
	body []byte,
	legacyArkResponse bool,
) (*OpenAIForwardResult, error) {
	if account == nil || account.Platform != PlatformOpenAI ||
		!account.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilitySeedance) {
		return nil, fmt.Errorf("video generation requires an OpenAI API key account with Seedance capability")
	}
	base, err := s.validateUpstreamBaseURL(account.GetCredential("base_url"))
	if err != nil {
		return nil, err
	}
	target, err := buildSeedanceVideoURL(base, endpoint, taskID)
	if err != nil {
		return nil, err
	}

	method := http.MethodGet
	model := ""
	upstreamModel := ""
	videoResolution := ""
	videoDurationSeconds := 0
	if endpoint == SeedanceVideoEndpointCreate {
		info := ParseGrokMediaRequest("application/json", body)
		if strings.TrimSpace(info.Model) == "" {
			return nil, fmt.Errorf("model is required")
		}
		if strings.TrimSpace(info.Prompt) == "" {
			return nil, fmt.Errorf("prompt is required")
		}
		model = info.Model
		upstreamModel = account.GetMappedModel(model)
		body, err = sjson.SetBytes(body, "model", upstreamModel)
		if err != nil {
			return nil, err
		}
		videoResolution = info.Resolution
		videoDurationSeconds = info.DurationSeconds
		method = http.MethodPost
	}

	token := strings.TrimSpace(account.GetCredential("api_key"))
	if token == "" {
		return nil, fmt.Errorf("video account missing api_key")
	}
	var bodyReader *bytes.Reader
	if endpoint == SeedanceVideoEndpointCreate {
		bodyReader = bytes.NewReader(body)
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	started := time.Now()
	upstreamCtx, releaseUpstreamCtx := detachUpstreamContext(ctx)
	defer releaseUpstreamCtx()
	req, err := http.NewRequestWithContext(upstreamCtx, method, target, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if endpoint == SeedanceVideoEndpointCreate {
		req.Header.Set("Content-Type", "application/json")
	}
	account.ApplyHeaderOverrides(req.Header)
	proxy := ""
	if account.ProxyID != nil && account.Proxy != nil {
		proxy = account.Proxy.URL()
	}
	resp, err := s.httpUpstream.Do(req, proxy, account.ID, account.Concurrency)
	SetOpsLatencyMs(c, OpsUpstreamLatencyMsKey, time.Since(started).Milliseconds())
	if err != nil {
		return nil, s.handleOpenAIUpstreamTransportError(ctx, c, account, err, false)
	}
	defer func() { _ = resp.Body.Close() }()

	if endpoint == SeedanceVideoEndpointContent {
		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			return nil, fmt.Errorf("video content redirect is not allowed")
		}
		if resp.StatusCode >= 400 {
			return s.handleGrokMediaErrorResponse(ctx, resp, c, account, "", "")
		}
		if err := writeGrokMediaContentResponse(c, resp); err != nil {
			return nil, err
		}
		return &OpenAIForwardResult{
			ResponseID:      taskID,
			ResponseHeaders: resp.Header.Clone(),
			Duration:        time.Since(started),
		}, nil
	}

	responseBody, err := ReadUpstreamResponseBody(resp.Body, s.cfg, c, openAITooLargeError)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		writeGrokMediaResponse(c, resp, responseBody, s.responseHeaderFilter)
		return nil, fmt.Errorf("video upstream status %d", resp.StatusCode)
	}

	result := &OpenAIForwardResult{
		Model:           model,
		BillingModel:    model,
		UpstreamModel:   upstreamModel,
		ResponseHeaders: resp.Header.Clone(),
		Duration:        time.Since(started),
	}
	switch endpoint {
	case SeedanceVideoEndpointCreate:
		responseID := strings.TrimSpace(gjson.GetBytes(responseBody, "id").String())
		if responseID == "" {
			responseID = strings.TrimSpace(gjson.GetBytes(responseBody, "task_id").String())
		}
		if responseID == "" {
			return nil, fmt.Errorf("video create response missing task ID")
		}
		result.ResponseID = responseID
		result.VideoResolution = NormalizeVideoBillingResolutionOrDefault(videoResolution)
		result.VideoDurationSeconds = NormalizeVideoBillingDurationSecondsForModelOrDefault(model, videoDurationSeconds)
	case SeedanceVideoEndpointStatus:
		if billed := ExtractSeedanceVideoBillingFromStatusBody(responseBody, taskID); billed != nil {
			result.ResponseID = firstNonEmpty(billed.ResponseID, taskID)
			result.Model = firstNonEmpty(billed.Model, result.Model)
			result.BillingModel = firstNonEmpty(billed.BillingModel, result.BillingModel)
			result.VideoCount = billed.VideoCount
			result.VideoDurationSeconds = billed.VideoDurationSeconds
		}
	}
	if result.ResponseID == "" && endpoint == SeedanceVideoEndpointStatus {
		result.ResponseID = taskID
	}
	clientBody := responseBody
	if legacyArkResponse {
		clientBody = normalizeSeedanceVideoResponseForArk(base, endpoint, responseBody)
	}
	writeGrokMediaResponse(c, resp, clientBody, s.responseHeaderFilter)
	return result, nil
}

func IsSeedanceVideoStatusBillable(statusBody []byte) bool {
	if len(statusBody) == 0 || !gjson.ValidBytes(statusBody) {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(gjson.GetBytes(statusBody, "status").String()))
	if status != "completed" && status != "succeeded" && status != "done" {
		return false
	}
	return strings.TrimSpace(gjson.GetBytes(statusBody, "metadata.url").String()) != "" ||
		strings.TrimSpace(gjson.GetBytes(statusBody, "video.url").String()) != ""
}

func ExtractSeedanceVideoBillingFromStatusBody(statusBody []byte, requestID string) *OpenAIForwardResult {
	if !IsSeedanceVideoStatusBillable(statusBody) {
		return nil
	}
	model := strings.TrimSpace(gjson.GetBytes(statusBody, "model").String())
	duration := int(gjson.GetBytes(statusBody, "duration").Int())
	responseID := firstNonEmpty(
		strings.TrimSpace(gjson.GetBytes(statusBody, "task_id").String()),
		strings.TrimSpace(gjson.GetBytes(statusBody, "id").String()),
		strings.TrimSpace(requestID),
	)
	return &OpenAIForwardResult{
		ResponseID:           responseID,
		Model:                model,
		BillingModel:         model,
		VideoCount:           1,
		VideoDurationSeconds: duration,
	}
}
