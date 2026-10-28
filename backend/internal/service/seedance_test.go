//go:build unit

package service

import (
	"context"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func seedanceTestAccount() *Account {
	return &Account{ID: 9, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{
		"api_key": "ark-secret", "base_url": "https://ark.cn-beijing.volces.com/api/v3",
		"openai_capabilities": []string{"seedance"},
		"model_mapping":       map[string]any{"video": "ep-seedance"},
	}}
}

func seedanceMomoTestAccount() *Account {
	return &Account{ID: 8, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{
		"api_key": "momo-secret", "base_url": "https://momoapi.xin/v1",
		"openai_capabilities": []string{"seedance"},
		"model_mapping":       map[string]any{"video": "seedance-2.5"},
	}}
}

func TestSeedanceNativeForwarding(t *testing.T) {
	body := []byte(`{"model":"video","content":[{"type":"text","text":"waves"},{"type":"image_url","image_url":{"url":"https://example.com/first.png"},"role":"first_frame"},{"type":"video_url","video_url":{"url":"https://example.com/ref.mp4"}},{"type":"audio_url","audio_url":{"url":"https://example.com/audio.mp3"}}],"duration":12,"resolution":"720p","ratio":"16:9","generate_audio":true,"future_field":{"keep":true}}`)
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(`{"id":"task-1"}`)}
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, w := grokMediaContentTestContext(http.MethodPost, "/api/v3/contents/generations/tasks", nil)
	result, err := svc.ForwardSeedance(context.Background(), c, seedanceTestAccount(), SeedanceEndpointCreate, "", body)
	require.NoError(t, err)
	require.JSONEq(t, `{"id":"task-1"}`, w.Body.String())
	require.Equal(t, "seedance:task-1", result.ResponseID)
	require.Zero(t, result.Usage.OutputTokens)
	require.Equal(t, "video", result.BillingModel)
	require.Equal(t, "ep-seedance", result.UpstreamModel)
	require.Equal(t, VideoBillingResolution720P, result.VideoResolution)
	require.Equal(t, 12, result.VideoDurationSeconds)
	require.Equal(t, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", upstream.request.URL.String())
	require.Equal(t, "Bearer ark-secret", upstream.request.Header.Get("Authorization"))
	forwarded, err := io.ReadAll(upstream.request.Body)
	require.NoError(t, err)
	require.Equal(t, "ep-seedance", gjson.GetBytes(forwarded, "model").String())
	for _, field := range []string{"content", "duration", "resolution", "ratio", "generate_audio", "future_field"} {
		require.Equal(t, gjson.GetBytes(body, field).Raw, gjson.GetBytes(forwarded, field).Raw)
	}
}

func TestSeedanceStatusAndDelete(t *testing.T) {
	for _, status := range []string{"queued", "running", "failed", "cancelled", "expired", "succeeded"} {
		t.Run(status, func(t *testing.T) {
			body := `{"id":"task-1","status":"` + status + `","model":"ep-seedance","content":{"video_url":"https://cdn.example/video.mp4"},"usage":{"completion_tokens":12345}}`
			upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(body)}
			svc := &OpenAIGatewayService{httpUpstream: upstream}
			c, w := grokMediaContentTestContext(http.MethodGet, "/api/v3/contents/generations/tasks/task-1", nil)
			result, err := svc.ForwardSeedance(context.Background(), c, seedanceTestAccount(), SeedanceEndpointStatus, "seedance:task-1", nil)
			require.NoError(t, err)
			require.JSONEq(t, body, w.Body.String())
			require.Equal(t, "/api/v3/contents/generations/tasks/task-1", upstream.request.URL.Path)
			if status == "succeeded" {
				require.Equal(t, 12345, result.Usage.OutputTokens)
			} else {
				require.Zero(t, result.Usage.OutputTokens)
			}
			require.Zero(t, result.VideoCount, "must use token billing, not Grok seconds")
		})
	}
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse("")}
	upstream.response.StatusCode = http.StatusNoContent
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, w := grokMediaContentTestContext(http.MethodDelete, "/api/v3/contents/generations/tasks/task-1", nil)
	_, err := svc.ForwardSeedance(context.Background(), c, seedanceTestAccount(), SeedanceEndpointDelete, "seedance:task-1", nil)
	require.NoError(t, err)
	require.Equal(t, http.MethodDelete, upstream.request.Method)
	require.Equal(t, http.StatusNoContent, w.Code)
}

func TestSeedanceMomoCompatibilityTranslatesArkCreateRequest(t *testing.T) {
	body := []byte(`{
		"model":"video",
		"content":[
			{"type":"text","text":"waves"},
			{"type":"image_url","image_url":{"url":"https://example.com/first.png"},"role":"first_frame"},
			{"type":"image_url","image_url":{"url":"https://example.com/last.png"},"role":"last_frame"},
			{"type":"image_url","image_url":{"url":"https://example.com/ref.png"},"role":"reference_image"},
			{"type":"video_url","video_url":{"url":"https://example.com/ref.mp4"}},
			{"type":"audio_url","audio_url":{"url":"https://example.com/ref.mp3"}}
		],
		"duration":12,
		"resolution":"720p",
		"ratio":"16:9",
		"generate_audio":true
	}`)
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(`{"id":"task-1","status":"queued"}`)}
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, w := grokMediaContentTestContext(http.MethodPost, "/api/v3/contents/generations/tasks", nil)

	result, err := svc.ForwardSeedance(context.Background(), c, seedanceMomoTestAccount(), SeedanceEndpointCreate, "", body)

	require.NoError(t, err)
	require.Equal(t, "https://momoapi.xin/v1/video/generations", upstream.request.URL.String())
	require.Equal(t, "seedance:task-1", result.ResponseID)
	forwarded, err := io.ReadAll(upstream.request.Body)
	require.NoError(t, err)
	require.Equal(t, "seedance-2.5", gjson.GetBytes(forwarded, "model").String())
	require.Equal(t, "waves", gjson.GetBytes(forwarded, "prompt").String())
	require.Equal(t, "reference-video", gjson.GetBytes(forwarded, "mode").String())
	require.Equal(t, "16:9", gjson.GetBytes(forwarded, "aspect_ratio").String())
	require.Equal(t, int64(12), gjson.GetBytes(forwarded, "duration").Int())
	require.Equal(t, "720p", gjson.GetBytes(forwarded, "resolution").String())
	require.Equal(t, []string{"https://example.com/first.png", "https://example.com/last.png"}, gjsonArrayStrings(gjson.GetBytes(forwarded, "images")))
	require.Equal(t, []string{"https://example.com/ref.png"}, gjsonArrayStrings(gjson.GetBytes(forwarded, "reference_image_urls")))
	require.Equal(t, []string{"https://example.com/ref.mp4"}, gjsonArrayStrings(gjson.GetBytes(forwarded, "reference_video_urls")))
	require.Equal(t, []string{"https://example.com/ref.mp3"}, gjsonArrayStrings(gjson.GetBytes(forwarded, "reference_audio_urls")))
	require.False(t, gjson.GetBytes(forwarded, "content").Exists())
	require.True(t, gjson.GetBytes(forwarded, "generate_audio").Bool())
	require.JSONEq(t, `{"id":"task-1","status":"queued"}`, w.Body.String())
}

func TestSeedanceMomoCompatibilityTranslatesLegacyStatus(t *testing.T) {
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(`{
		"id":"task-1",
		"status":"completed",
		"model":"seedance-2.5",
		"duration":5,
		"metadata":{"url":"https://momoapi.xin/v1/videos/task-1/content"}
	}`)}
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, w := grokMediaContentTestContext(http.MethodGet, "/api/v3/contents/generations/tasks/task-1", nil)

	result, err := svc.ForwardSeedance(context.Background(), c, seedanceMomoTestAccount(), SeedanceEndpointStatus, "seedance:task-1", nil)

	require.NoError(t, err)
	require.Equal(t, "https://momoapi.xin/v1/videos/task-1", upstream.request.URL.String())
	require.Equal(t, "seedance:task-1", result.ResponseID)
	require.Equal(t, "succeeded", gjson.GetBytes(w.Body.Bytes(), "status").String())
	require.Equal(t, "task-1", gjson.GetBytes(w.Body.Bytes(), "id").String())
	require.Equal(t, "https://momoapi.xin/v1/videos/task-1/content", gjson.GetBytes(w.Body.Bytes(), "content.video_url").String())
}

func gjsonArrayStrings(value gjson.Result) []string {
	values := make([]string, 0, len(value.Array()))
	for _, item := range value.Array() {
		values = append(values, item.String())
	}
	return values
}

func TestSeedanceValidationAndCapability(t *testing.T) {
	for _, body := range []string{`{`, `[]`, `{}`, `{"model":12,"content":[{}]}`, `{"model":"x","content":[]}`} {
		_, err := ParseSeedanceRequest([]byte(body))
		require.Error(t, err)
	}
	info, err := ParseSeedanceRequest([]byte(`{"model":"x","content":[{"type":"text","text":"first"},{"type":"text","text":"second"},{"type":"image_url","image_url":{"url":"https://example.com/a.png"}}],"duration":"30","resolution":"1080p"}`))
	require.NoError(t, err)
	require.Equal(t, 30, info.DurationSeconds)
	require.Equal(t, "1080p", info.Resolution)
	require.Contains(t, string(info.ModerationBody()), "first")
	require.Contains(t, string(info.ModerationBody()), "second")
	require.Contains(t, string(info.ModerationBody()), "https://example.com/a.png")
	for _, id := range []string{"", "..", "a/b", "a?b", "a#b", "%2e%2e"} {
		_, err := buildSeedanceURL("https://example.com", SeedanceEndpointStatus, id)
		require.Error(t, err, id)
	}
	for _, base := range []string{"https://example.com", "https://example.com/api/v3/", "https://example.com/v3"} {
		url, err := buildSeedanceURL(base, SeedanceEndpointCreate, "")
		require.NoError(t, err)
		require.NotContains(t, url, "/v3/api/v3")
	}
	a := seedanceTestAccount()
	require.True(t, a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilitySeedance))
	a.Type = AccountTypeOAuth
	require.False(t, a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilitySeedance))
	a.Type = AccountTypeAPIKey
	delete(a.Credentials, "openai_capabilities")
	require.False(t, a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilitySeedance))
	require.Equal(t, 30, NormalizeVideoBillingDurationSecondsForModelOrDefault("dreamina-seedance-2-5", 30))
	require.Equal(t, VideoBillingMaxDurationSeconds, NormalizeVideoBillingDurationSecondsForModelOrDefault("grok-imagine-video", 30))
}

func TestSeedancePreservesUpstreamErrorsWithoutRetry(t *testing.T) {
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(`{"error":{"code":"QuotaExceeded","message":"quota exhausted"}}`)}
	upstream.response.StatusCode = 429
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, w := grokMediaContentTestContext(http.MethodPost, "/api/v3/contents/generations/tasks", nil)
	_, err := svc.ForwardSeedance(context.Background(), c, seedanceTestAccount(), SeedanceEndpointCreate, "", []byte(`{"model":"video","content":[{"type":"text","text":"waves"}]}`))
	require.Error(t, err)
	require.Equal(t, 429, w.Code)
	require.Contains(t, w.Body.String(), "QuotaExceeded")
	require.Len(t, upstream.requests, 1)
}
