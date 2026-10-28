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

func seedanceVideoTestAccount() *Account {
	return &Account{
		ID:       8,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		Credentials: map[string]any{
			"api_key":             "video-secret",
			"base_url":            "https://openpix.cc",
			"openai_capabilities": []string{"seedance"},
			"model_mapping": map[string]any{
				"dreamina-seedance-public": "dreamina-seedance-upstream",
			},
		},
	}
}

func TestBuildSeedanceVideoURL(t *testing.T) {
	create, err := buildSeedanceVideoURL("https://openpix.cc", SeedanceVideoEndpointCreate, "")
	require.NoError(t, err)
	require.Equal(t, "https://openpix.cc/v1/video/generations", create)

	status, err := buildSeedanceVideoURL("https://openpix.cc/v1/", SeedanceVideoEndpointStatus, "task-1")
	require.NoError(t, err)
	require.Equal(t, "https://openpix.cc/v1/videos/task-1", status)

	content, err := buildSeedanceVideoURL("https://openpix.cc/v1", SeedanceVideoEndpointContent, "task-1")
	require.NoError(t, err)
	require.Equal(t, "https://openpix.cc/v1/videos/task-1/content", content)
}

func TestSeedanceVideoCreatePreservesBody(t *testing.T) {
	body := []byte(`{
		"model":"dreamina-seedance-public",
		"mode":"reference-images",
		"prompt":"continue",
		"duration":5,
		"resolution":"480p",
		"aspect_ratio":"16:9",
		"reference_image_urls":["https://cdn.example.com/ref.png"],
		"future_field":{"keep":true}
	}`)
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(`{"id":"task-1","status":"queued"}`)}
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, w := grokMediaContentTestContext(http.MethodPost, "/v1/video/generations", nil)

	result, err := svc.ForwardSeedanceVideo(
		context.Background(),
		c,
		seedanceVideoTestAccount(),
		SeedanceVideoEndpointCreate,
		"",
		body,
	)
	require.NoError(t, err)
	require.Equal(t, "task-1", result.ResponseID)
	require.Equal(t, "https://openpix.cc/v1/video/generations", upstream.request.URL.String())
	require.JSONEq(t, `{"id":"task-1","status":"queued"}`, w.Body.String())

	forwarded, err := io.ReadAll(upstream.request.Body)
	require.NoError(t, err)
	require.Equal(t, "dreamina-seedance-upstream", gjson.GetBytes(forwarded, "model").String())
	for _, field := range []string{
		"mode",
		"prompt",
		"duration",
		"resolution",
		"aspect_ratio",
		"reference_image_urls",
		"future_field",
	} {
		require.Equal(t, gjson.GetBytes(body, field).Raw, gjson.GetBytes(forwarded, field).Raw, field)
	}
}

func TestSeedanceVideoCompletedStatusIsBillable(t *testing.T) {
	body := `{
		"id":"task-1",
		"task_id":"task-1",
		"model":"dreamina-seedance-upstream",
		"status":"completed",
		"duration":5,
		"metadata":{"url":"/v1/videos/task-1/content"}
	}`
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(body)}
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, _ := grokMediaContentTestContext(http.MethodGet, "/v1/videos/task-1", nil)

	result, err := svc.ForwardSeedanceVideo(
		context.Background(),
		c,
		seedanceVideoTestAccount(),
		SeedanceVideoEndpointStatus,
		"task-1",
		nil,
	)
	require.NoError(t, err)
	require.Equal(t, 1, result.VideoCount)
	require.Equal(t, 5, result.VideoDurationSeconds)
	require.True(t, IsSeedanceVideoStatusBillable([]byte(body)))
}
