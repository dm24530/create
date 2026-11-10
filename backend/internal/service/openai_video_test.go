//go:build unit

package service

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func museVideoTestAccount() *Account {
	return &Account{
		ID:       20,
		Platform: PlatformMuse,
		Type:     AccountTypeAPIKey,
		Credentials: map[string]any{
			"api_key":  "muse-secret",
			"base_url": "https://momoapi.xin/v1",
		},
	}
}

func TestOpenAIVideoCompletedStatusIsBillableForMuse(t *testing.T) {
	body := `{
		"id":"task-muse",
		"task_id":"task-muse",
		"model":"muse-video",
		"status":"completed",
		"progress":100,
		"metadata":{"url":"https://momoapi.xin/v1/videos/task-muse/content"}
	}`
	upstream := &grokMediaContentUpstreamStub{response: grokMediaContentStatusResponse(body)}
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	c, w := grokMediaContentTestContext(http.MethodGet, "/v1/videos/task-muse", nil)

	result, err := svc.ForwardOpenAIVideo(
		context.Background(),
		c,
		museVideoTestAccount(),
		OpenAIVideoEndpointStatus,
		"task-muse",
		nil,
	)
	require.NoError(t, err)
	require.Equal(t, 1, result.VideoCount)
	require.Equal(t, "muse-video", result.Model)
	require.JSONEq(t, body, w.Body.String())
}
