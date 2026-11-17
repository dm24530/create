package service

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	openAIVideoMaxContentBytes = 512 << 20

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
		durationSeconds, err := writeOpenAIVideoContentResponse(c, resp)
		if err != nil {
			return nil, err
		}
		return &OpenAIForwardResult{
			ResponseID:           taskID,
			ResponseHeaders:      resp.Header.Clone(),
			Duration:             time.Since(started),
			VideoCount:           1,
			VideoDurationSeconds: durationSeconds,
		}, nil
	}

	responseBody, err := ReadUpstreamResponseBody(resp.Body, s.cfg, c, openAITooLargeError)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		writeGrokMediaResponse(c, resp, sanitizeMediaStatusResponseForClient(responseBody, ""), s.responseHeaderFilter)
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
	if endpoint == OpenAIVideoEndpointStatus {
		responseBody = sanitizeMediaStatusResponseForClient(
			responseBody,
			grokMediaContentProxyURL(c, taskID),
		)
	}
	writeGrokMediaResponse(c, resp, responseBody, s.responseHeaderFilter)
	return result, nil
}

func writeOpenAIVideoContentResponse(c *gin.Context, resp *http.Response) (int, error) {
	if c == nil || resp == nil || resp.Body == nil {
		return 0, fmt.Errorf("video content response is incomplete")
	}
	if strings.TrimSpace(resp.Header.Get("Content-Range")) != "" {
		return 0, writeGrokMediaContentResponse(c, resp)
	}
	if resp.ContentLength > openAIVideoMaxContentBytes {
		return 0, fmt.Errorf("video content exceeds the local inspection limit")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, openAIVideoMaxContentBytes+1))
	if err != nil {
		return 0, err
	}
	if len(body) > openAIVideoMaxContentBytes {
		return 0, fmt.Errorf("video content exceeds the local inspection limit")
	}
	for _, name := range []string{
		"Content-Type",
		"Content-Length",
		"Content-Range",
		"Accept-Ranges",
		"Content-Disposition",
	} {
		if value := strings.TrimSpace(resp.Header.Get(name)); value != "" {
			c.Header(name, value)
		}
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Data(resp.StatusCode, contentType, body)
	MarkResponseCommitted(c)
	return extractMP4DurationSeconds(body), nil
}

// extractMP4DurationSeconds reads the MP4 mvhd header without requiring ffprobe.
// It is used to verify delivered media duration for automatic billing and to
// detect provider mismatches without altering or re-encoding the video.
func extractMP4DurationSeconds(body []byte) int {
	searchFrom := 0
	for searchFrom < len(body) {
		offset := bytes.Index(body[searchFrom:], []byte("mvhd"))
		if offset < 0 {
			return 0
		}
		payload := searchFrom + offset + 4
		if payload+20 <= len(body) {
			version := body[payload]
			if version == 0 {
				timescale := binary.BigEndian.Uint32(body[payload+12 : payload+16])
				duration := uint64(binary.BigEndian.Uint32(body[payload+16 : payload+20]))
				if seconds := mp4DurationToSeconds(timescale, duration); seconds > 0 {
					return seconds
				}
			}
			if version == 1 && payload+32 <= len(body) {
				timescale := binary.BigEndian.Uint32(body[payload+20 : payload+24])
				duration := binary.BigEndian.Uint64(body[payload+24 : payload+32])
				if seconds := mp4DurationToSeconds(timescale, duration); seconds > 0 {
					return seconds
				}
			}
		}
		searchFrom = payload
	}
	return 0
}

func mp4DurationToSeconds(timescale uint32, duration uint64) int {
	if timescale == 0 || duration == 0 {
		return 0
	}
	// Round to the nearest second to avoid charging an extra second for normal
	// container timestamp overhead (for example a 10.04s MP4).
	seconds := (duration + uint64(timescale)/2) / uint64(timescale)
	if seconds == 0 {
		seconds = 1
	}
	if seconds > 24*60*60 {
		return 0
	}
	return int(seconds)
}
