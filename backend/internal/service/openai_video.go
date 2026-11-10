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
	OpenAIVideoEndpointCreate  GrokMediaEndpoint = "openai_video_create"
	OpenAIVideoEndpointStatus  GrokMediaEndpoint = "openai_video_status"
	OpenAIVideoEndpointContent GrokMediaEndpoint = "openai_video_content"
)

func (e GrokMediaEndpoint) IsOpenAIVideo() bool {
	return e == OpenAIVideoEndpointCreate || e == OpenAIVideoEndpointStatus || e == OpenAIVideoEndpointContent
}

func buildOpenAIVideoURL(base string, endpoint GrokMediaEndpoint, taskID string) (string, error) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return "", fmt.Errorf("video base URL is required")
	}
	if !strings.HasSuffix(base, "/v1") {
		base += "/v1"
	}
	switch endpoint {
	case OpenAIVideoEndpointCreate:
		return base + "/videos", nil
	case OpenAIVideoEndpointStatus:
		if err := validateUpstreamPathSegment("video task ID", taskID); err != nil || strings.TrimSpace(taskID) == "" {
			return "", fmt.Errorf("invalid video task ID")
		}
		return base + "/videos/" + taskID, nil
	case OpenAIVideoEndpointContent:
		if err := validateUpstreamPathSegment("video task ID", taskID); err != nil || strings.TrimSpace(taskID) == "" {
			return "", fmt.Errorf("invalid video task ID")
		}
		return base + "/videos/" + taskID + "/content", nil
	default:
		return "", fmt.Errorf("unsupported video endpoint: %s", endpoint)
	}
}

func (s *OpenAIGatewayService) ForwardOpenAIVideo(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	endpoint GrokMediaEndpoint,
	taskID string,
	body []byte,
) (*OpenAIForwardResult, error) {
	if account == nil || account.Type != AccountTypeAPIKey ||
		(account.Platform != PlatformMiniMax && account.Platform != PlatformOpenAI && account.Platform != PlatformMuse) {
		return nil, fmt.Errorf("video generation requires a minimax, openai, or muse API key account")
	}
	base, err := s.validateUpstreamBaseURL(account.GetCredential("base_url"))
	if err != nil {
		return nil, err
	}
	target, err := buildOpenAIVideoURL(base, endpoint, taskID)
	if err != nil {
		return nil, err
	}

	method := http.MethodGet
	model, upstreamModel, resolution := "", "", ""
	durationSeconds := 0
	if endpoint == OpenAIVideoEndpointCreate {
		model = strings.TrimSpace(gjson.GetBytes(body, "model").String())
		if model == "" {
			return nil, fmt.Errorf("model is required")
		}
		if strings.TrimSpace(firstNonEmpty(
			gjson.GetBytes(body, "prompt").String(),
			gjson.GetBytes(body, "content.0.text").String(),
		)) == "" {
			return nil, fmt.Errorf("prompt is required")
		}
		upstreamModel = account.GetMappedModel(model)
		body, err = sjson.SetBytes(body, "model", upstreamModel)
		if err != nil {
			return nil, err
		}
		resolution = strings.TrimSpace(gjson.GetBytes(body, "resolution").String())
		durationSeconds = int(gjson.GetBytes(body, "seconds").Int())
		if durationSeconds <= 0 {
			durationSeconds = int(gjson.GetBytes(body, "duration").Int())
		}
		if durationSeconds <= 0 {
			durationSeconds = 5
		}
		method = http.MethodPost
	}

	token := strings.TrimSpace(account.GetCredential("api_key"))
	if token == "" {
		return nil, fmt.Errorf("video account missing api_key")
	}
	var bodyReader *bytes.Reader
	if endpoint == OpenAIVideoEndpointCreate {
		bodyReader = bytes.NewReader(body)
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	started := time.Now()
	upstreamCtx, release := detachUpstreamContext(ctx)
	defer release()
	req, err := http.NewRequestWithContext(upstreamCtx, method, target, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if endpoint == OpenAIVideoEndpointCreate {
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

	if endpoint == OpenAIVideoEndpointContent {
		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			return nil, fmt.Errorf("video content redirect is not allowed")
		}
		if resp.StatusCode >= 400 {
			return s.handleGrokMediaErrorResponse(ctx, resp, c, account, "", "")
		}
		if err := writeGrokMediaContentResponse(c, resp); err != nil {
			return nil, err
		}
		return &OpenAIForwardResult{ResponseID: taskID, ResponseHeaders: resp.Header.Clone(), Duration: time.Since(started)}, nil
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
		Model: model, BillingModel: model, UpstreamModel: upstreamModel,
		ResponseHeaders: resp.Header.Clone(), Duration: time.Since(started),
	}
	if endpoint == OpenAIVideoEndpointCreate {
		responseID := strings.TrimSpace(firstNonEmpty(
			gjson.GetBytes(responseBody, "id").String(),
			gjson.GetBytes(responseBody, "task_id").String(),
		))
		if responseID == "" {
			return nil, fmt.Errorf("video create response missing task ID")
		}
		result.ResponseID = responseID
		result.VideoResolution = NormalizeVideoBillingResolutionForModelOrDefault(model, resolution)
		result.VideoDurationSeconds = durationSeconds
	} else {
		result.ResponseID = taskID
		result.Model = strings.TrimSpace(gjson.GetBytes(responseBody, "model").String())
		result.BillingModel = result.Model
		if endpoint == OpenAIVideoEndpointStatus && IsSeedanceVideoStatusBillable(responseBody) {
			result.VideoCount = 1
			result.VideoDurationSeconds = int(gjson.GetBytes(responseBody, "duration").Int())
		}
	}
	writeGrokMediaResponse(c, resp, responseBody, s.responseHeaderFilter)
	return result, nil
}
