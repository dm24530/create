//go:build unit

package service

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"strconv"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

func mvhdBoxForTest(timescale uint32, duration uint32) []byte {
	box := make([]byte, 28)
	binary.BigEndian.PutUint32(box[0:4], uint32(len(box)))
	copy(box[4:8], "mvhd")
	box[8] = 0
	binary.BigEndian.PutUint32(box[20:24], timescale)
	binary.BigEndian.PutUint32(box[24:28], duration)
	return box
}

func TestExtractMP4DurationSeconds(t *testing.T) {
	t.Parallel()

	require.Equal(t, 10, extractMP4DurationSeconds(mvhdBoxForTest(24_000, 240_000)))
	require.Equal(t, 4, extractMP4DurationSeconds(append([]byte("junk"), mvhdBoxForTest(1_000, 4_000)...)))
	require.Zero(t, extractMP4DurationSeconds([]byte("not-an-mp4")))
}

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

func TestForwardOpenAIVideoContentUsesDeliveredMediaDuration(t *testing.T) {
	mp4 := append([]byte("ftypmp42"), mvhdBoxForTest(24_000, 240_000)...)
	upstream := &grokMediaContentUpstreamStub{response: &http.Response{
		StatusCode:    http.StatusOK,
		Header:        http.Header{"Content-Type": []string{"video/mp4"}, "Content-Length": []string{strconv.Itoa(len(mp4))}},
		Body:          io.NopCloser(bytes.NewReader(mp4)),
		ContentLength: int64(len(mp4)),
	}}
	svc := &OpenAIGatewayService{cfg: &config.Config{}, httpUpstream: upstream}
	c, recorder := grokMediaContentTestContext(http.MethodGet, "/v1/videos/task-muse/content", nil)

	result, err := svc.ForwardOpenAIVideo(
		context.Background(), c, museVideoTestAccount(), OpenAIVideoEndpointContent, "task-muse", nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, 1, result.VideoCount)
	require.Equal(t, 10, result.VideoDurationSeconds)
	require.Equal(t, mp4, recorder.Body.Bytes())
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
	require.JSONEq(t, `{
		"id":"task-muse",
		"task_id":"task-muse",
		"model":"muse-video",
		"status":"completed",
		"progress":100,
		"metadata":{"url":"/v1/videos/task-muse/content"}
	}`, w.Body.String())
}
