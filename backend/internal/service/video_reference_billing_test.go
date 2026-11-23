package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParseGrokMediaRequestCountsReferenceImageAliases(t *testing.T) {
	body := []byte(`{
		"model": "minimax H3",
		"prompt": "test",
		"reference_image_urls": ["https://cdn.example/1.png", "https://cdn.example/2.png"],
		"image_urls": ["https://cdn.example/3.png"]
	}`)
	info := ParseGrokMediaRequest("application/json", body)
	require.Equal(t, 3, info.ReferenceImageCount)
}

func TestParseGrokMediaRequestCollectsReferenceVideoURLs(t *testing.T) {
	body := []byte(`{
		"model": "seedance 2.0 mini-GT",
		"prompt": "test",
		"reference_video_urls": ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"],
		"content": [
			{"type":"video_url","video_url":{"url":"https://cdn.example/3.mp4"}}
		]
	}`)
	info := ParseGrokMediaRequest("application/json", body)
	require.Equal(t, []string{
		"https://cdn.example/1.mp4",
		"https://cdn.example/2.mp4",
		"https://cdn.example/3.mp4",
	}, info.ReferenceVideoURLs)
}

func TestProbeReferenceVideoBillingSecondsModes(t *testing.T) {
	oldProbe := probeReferenceVideoDuration
	defer func() { probeReferenceVideoDuration = oldProbe }()
	probeReferenceVideoDuration = func(_ context.Context, rawURL string) (time.Duration, error) {
		switch rawURL {
		case "https://cdn.example/1.mp4":
			return 2 * time.Second, nil
		case "https://cdn.example/2.mp4":
			return 3500 * time.Millisecond, nil
		default:
			return 0, errors.New("unexpected URL")
		}
	}
	urls := []string{"https://cdn.example/1.mp4", "https://cdn.example/2.mp4"}
	maxSeconds, err := ProbeReferenceVideoBillingSeconds(context.Background(), urls, VideoReferenceBillingModeMaxSeconds)
	require.NoError(t, err)
	require.Equal(t, 4, maxSeconds)
	sumSeconds, err := ProbeReferenceVideoBillingSeconds(context.Background(), urls, VideoReferenceBillingModeSumSeconds)
	require.NoError(t, err)
	require.Equal(t, 6, sumSeconds)
}
