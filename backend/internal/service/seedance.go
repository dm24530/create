package service

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	SeedanceEndpointCreate           GrokMediaEndpoint        = "seedance_create"
	SeedanceEndpointStatus           GrokMediaEndpoint        = "seedance_status"
	SeedanceEndpointDelete           GrokMediaEndpoint        = "seedance_delete"
	OpenAIEndpointCapabilitySeedance OpenAIEndpointCapability = "seedance"
)

func (e GrokMediaEndpoint) IsSeedance() bool {
	return e == SeedanceEndpointCreate || e == SeedanceEndpointStatus || e == SeedanceEndpointDelete
}

// SeedanceTaskKey isolates ownership and billing keys from other video providers.
func SeedanceTaskKey(id string) string { return "seedance:" + strings.TrimSpace(id) }

func ParseSeedanceRequest(body []byte) (GrokMediaRequestInfo, error) {
	var info GrokMediaRequestInfo
	if !gjson.ValidBytes(body) || !gjson.ParseBytes(body).IsObject() {
		return info, fmt.Errorf("request body must be a JSON object")
	}
	model := gjson.GetBytes(body, "model")
	if model.Type != gjson.String || strings.TrimSpace(model.String()) == "" {
		return info, fmt.Errorf("model is required")
	}
	content := gjson.GetBytes(body, "content")
	if !content.IsArray() || len(content.Array()) == 0 {
		return info, fmt.Errorf("content must be a non-empty array")
	}
	info.Model = strings.TrimSpace(model.String())
	info.Resolution = strings.TrimSpace(gjson.GetBytes(body, "resolution").String())
	duration := gjson.GetBytes(body, "duration")
	if duration.Exists() {
		switch duration.Type {
		case gjson.Number:
			info.DurationSeconds = int(duration.Int())
		case gjson.String:
			if parsed, parseErr := strconv.Atoi(strings.TrimSpace(duration.String())); parseErr == nil {
				info.DurationSeconds = parsed
			}
		}
	}
	var texts []string
	for _, item := range content.Array() {
		switch item.Get("type").String() {
		case "text":
			texts = append(texts, item.Get("text").String())
		case "image_url":
			info.InputImageURLs = append(info.InputImageURLs, item.Get("image_url.url").String())
		}
	}
	info.Prompt = strings.Join(texts, "\n")
	return info, nil
}

func buildSeedanceURL(base string, endpoint GrokMediaEndpoint, taskID string) (string, error) {
	base = strings.TrimRight(base, "/")
	// Accept an origin, a proxy prefix, or the full Ark API base.
	if !strings.HasSuffix(base, "/api/v3") && !strings.HasSuffix(base, "/v3") {
		base += "/api/v3"
	}
	base += "/contents/generations/tasks"
	if endpoint != SeedanceEndpointCreate {
		if err := validateUpstreamPathSegment("Seedance task ID", taskID); err != nil || strings.TrimSpace(taskID) == "" {
			return "", fmt.Errorf("invalid Seedance task ID")
		}
		base += "/" + taskID
	}
	return base, nil
}

func isMomoVideoBaseURL(base string) bool {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "momoapi.xin" || strings.HasSuffix(host, ".momoapi.xin")
}

func buildMomoVideoBodyFromArk(body []byte) ([]byte, error) {
	info, err := ParseSeedanceRequest(body)
	if err != nil {
		return nil, err
	}
	content := gjson.GetBytes(body, "content")
	var images []string
	var referenceImages []string
	var referenceVideos []string
	var referenceAudios []string
	firstFrame := ""
	lastFrame := ""
	for _, item := range content.Array() {
		switch strings.ToLower(strings.TrimSpace(item.Get("type").String())) {
		case "image_url":
			imageURL := strings.TrimSpace(item.Get("image_url.url").String())
			if imageURL == "" {
				imageURL = strings.TrimSpace(item.Get("image_url").String())
			}
			if imageURL == "" {
				continue
			}
			switch strings.ToLower(strings.TrimSpace(item.Get("role").String())) {
			case "first_frame", "first-frame":
				firstFrame = imageURL
			case "last_frame", "last-frame":
				lastFrame = imageURL
			case "reference_image", "reference-image":
				referenceImages = append(referenceImages, imageURL)
			default:
				images = append(images, imageURL)
			}
		case "video_url":
			if videoURL := strings.TrimSpace(item.Get("video_url.url").String()); videoURL != "" {
				referenceVideos = append(referenceVideos, videoURL)
			}
		case "audio_url":
			if audioURL := strings.TrimSpace(item.Get("audio_url.url").String()); audioURL != "" {
				referenceAudios = append(referenceAudios, audioURL)
			}
		}
	}
	if firstFrame != "" {
		images = append([]string{firstFrame}, images...)
	}
	if lastFrame != "" {
		images = append(images, lastFrame)
	}

	mode := "text-to-video"
	switch {
	case len(referenceVideos) > 0:
		mode = "reference-video"
	case firstFrame != "" && lastFrame != "":
		mode = "first-last-frame"
	case firstFrame != "" || lastFrame != "" || len(images) > 0:
		mode = "image-to-video"
	case len(referenceImages) > 0:
		mode = "reference-images"
	}

	translated := []byte(`{}`)
	translated, _ = sjson.SetBytes(translated, "model", info.Model)
	translated, _ = sjson.SetBytes(translated, "mode", mode)
	translated, _ = sjson.SetBytes(translated, "prompt", info.Prompt)
	if len(images) > 0 {
		translated, _ = sjson.SetBytes(translated, "images", images)
	}
	if len(referenceImages) > 0 {
		translated, _ = sjson.SetBytes(translated, "reference_image_urls", referenceImages)
	}
	if len(referenceVideos) > 0 {
		translated, _ = sjson.SetBytes(translated, "reference_video_urls", referenceVideos)
	}
	if len(referenceAudios) > 0 {
		translated, _ = sjson.SetBytes(translated, "reference_audio_urls", referenceAudios)
	}
	if duration := gjson.GetBytes(body, "duration"); duration.Exists() {
		switch duration.Type {
		case gjson.Number:
			translated, _ = sjson.SetBytes(translated, "duration", duration.Int())
		case gjson.String:
			if seconds, parseErr := strconv.Atoi(strings.TrimSpace(duration.String())); parseErr == nil {
				translated, _ = sjson.SetBytes(translated, "duration", seconds)
			}
		}
	}
	if resolution := strings.TrimSpace(gjson.GetBytes(body, "resolution").String()); resolution != "" {
		translated, _ = sjson.SetBytes(translated, "resolution", resolution)
	}
	if aspectRatio := strings.TrimSpace(gjson.GetBytes(body, "ratio").String()); aspectRatio != "" {
		translated, _ = sjson.SetBytes(translated, "aspect_ratio", aspectRatio)
	}
	if generateAudio := gjson.GetBytes(body, "generate_audio"); generateAudio.Exists() && generateAudio.Type == gjson.True {
		translated, _ = sjson.SetBytes(translated, "generate_audio", true)
	} else if generateAudio.Exists() && generateAudio.Type == gjson.False {
		translated, _ = sjson.SetBytes(translated, "generate_audio", false)
	}
	return translated, nil
}

func normalizeSeedanceVideoResponseForArk(base string, endpoint GrokMediaEndpoint, body []byte) []byte {
	if len(body) == 0 || !gjson.ValidBytes(body) {
		return body
	}
	normalized := append([]byte(nil), body...)
	responseID := strings.TrimSpace(gjson.GetBytes(normalized, "id").String())
	if responseID == "" {
		responseID = strings.TrimSpace(gjson.GetBytes(normalized, "task_id").String())
		if responseID != "" {
			normalized, _ = sjson.SetBytes(normalized, "id", responseID)
		}
	}
	if endpoint != SeedanceEndpointStatus && endpoint != SeedanceVideoEndpointStatus {
		return normalized
	}
	switch strings.ToLower(strings.TrimSpace(gjson.GetBytes(normalized, "status").String())) {
	case "completed", "done":
		normalized, _ = sjson.SetBytes(normalized, "status", "succeeded")
	}
	videoURL := strings.TrimSpace(gjson.GetBytes(normalized, "content.video_url").String())
	if videoURL == "" {
		videoURL = strings.TrimSpace(gjson.GetBytes(normalized, "metadata.url").String())
	}
	if videoURL == "" {
		videoURL = strings.TrimSpace(gjson.GetBytes(normalized, "video.url").String())
	}
	if videoURL != "" {
		normalized, _ = sjson.SetBytes(normalized, "content.video_url", resolveMomoVideoResourceURL(base, videoURL))
	}
	return normalized
}

func resolveMomoVideoResourceURL(base, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	resource, err := url.Parse(raw)
	if err != nil || resource.IsAbs() {
		return raw
	}
	upstream, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return raw
	}
	return upstream.ResolveReference(resource).String()
}

// ForwardSeedance preserves the Ark protocol, including multimodal content and
// future fields. Only model is rewritten using the account's configured mapping.
func (s *OpenAIGatewayService) ForwardSeedance(ctx context.Context, c *gin.Context, account *Account, endpoint GrokMediaEndpoint, taskID string, body []byte) (*OpenAIForwardResult, error) {
	if !account.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilitySeedance) || !endpoint.IsSeedance() {
		return nil, fmt.Errorf("seedance requires an OpenAI API key account with a custom base URL")
	}
	base, err := s.validateUpstreamBaseURL(account.GetCredential("base_url"))
	if err != nil {
		return nil, err
	}
	if isMomoVideoBaseURL(base) {
		upstreamTaskID := strings.TrimPrefix(taskID, "seedance:")
		var videoEndpoint GrokMediaEndpoint
		switch endpoint {
		case SeedanceEndpointCreate:
			body, err = buildMomoVideoBodyFromArk(body)
			if err != nil {
				return nil, err
			}
			videoEndpoint = SeedanceVideoEndpointCreate
		case SeedanceEndpointStatus:
			videoEndpoint = SeedanceVideoEndpointStatus
		default:
			return nil, fmt.Errorf("Momo video API does not support task deletion")
		}
		result, forwardErr := s.forwardSeedanceVideo(ctx, c, account, videoEndpoint, upstreamTaskID, body, true)
		if result != nil {
			result.ResponseID = SeedanceTaskKey(strings.TrimPrefix(result.ResponseID, "seedance:"))
		}
		return result, forwardErr
	}
	target, err := buildSeedanceURL(base, endpoint, strings.TrimPrefix(taskID, "seedance:"))
	if err != nil {
		return nil, err
	}
	model, upstreamModel := "", ""
	videoResolution := ""
	videoDurationSeconds := 0
	method := http.MethodGet
	switch endpoint {
	case SeedanceEndpointCreate:
		info, parseErr := ParseSeedanceRequest(body)
		if parseErr != nil {
			return nil, parseErr
		}
		model = info.Model
		videoResolution = info.Resolution
		videoDurationSeconds = info.DurationSeconds
		upstreamModel = account.GetMappedModel(model)
		body, err = sjson.SetBytes(body, "model", upstreamModel)
		if err != nil {
			return nil, err
		}
		method = http.MethodPost
	case SeedanceEndpointDelete:
		method = http.MethodDelete
	}
	token := strings.TrimSpace(account.GetCredential("api_key"))
	if token == "" {
		return nil, fmt.Errorf("seedance account missing api_key")
	}
	started := time.Now()
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	account.ApplyHeaderOverrides(req.Header)
	proxy := ""
	if account.ProxyID != nil && account.Proxy != nil {
		proxy = account.Proxy.URL()
	}
	resp, err := s.httpUpstream.Do(req, proxy, account.ID, account.Concurrency)
	SetOpsLatencyMs(c, OpsUpstreamLatencyMsKey, time.Since(started).Milliseconds())
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	responseBody, err := ReadUpstreamResponseBody(resp.Body, s.cfg, c, openAITooLargeError)
	if err != nil {
		return nil, err
	}
	// Do not retry ambiguous asynchronous creates: the upstream may already have
	// accepted a billable job. Preserve native error codes and response bodies.
	if resp.StatusCode >= 300 {
		writeGrokMediaResponse(c, resp, responseBody, s.responseHeaderFilter)
		return nil, fmt.Errorf("seedance upstream status %d", resp.StatusCode)
	}
	result := &OpenAIForwardResult{Model: model, BillingModel: model, UpstreamModel: upstreamModel, Duration: time.Since(started), ResponseHeaders: resp.Header.Clone()}
	if endpoint == SeedanceEndpointCreate {
		id := strings.TrimSpace(gjson.GetBytes(responseBody, "id").String())
		if id == "" {
			return nil, fmt.Errorf("seedance create response missing task ID")
		}
		result.ResponseID = SeedanceTaskKey(id)
		result.VideoResolution = NormalizeVideoBillingResolutionOrDefault(videoResolution)
		result.VideoDurationSeconds = NormalizeVideoBillingDurationSecondsForModelOrDefault(model, videoDurationSeconds)
	}
	if endpoint == SeedanceEndpointStatus {
		result.ResponseID = taskID
		result.UpstreamModel = gjson.GetBytes(responseBody, "model").String()
		if gjson.GetBytes(responseBody, "status").String() == "succeeded" {
			result.Usage.OutputTokens = max(0, int(gjson.GetBytes(responseBody, "usage.completion_tokens").Int()))
		}
	}
	writeGrokMediaResponse(c, resp, responseBody, s.responseHeaderFilter)
	return result, nil
}
