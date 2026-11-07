package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRewriteGeminiRemoteFileDataInlinesR2Images(t *testing.T) {
	body := []byte(`{
		"contents":[{"role":"user","parts":[
			{"text":"图片1是客厅，图片2是小猫"},
			{"fileData":{"mimeType":"image/png","fileUri":"https://bucket.r2.cloudflarestorage.com/room.png?signature=1"}},
			{"fileData":{"mimeType":"image/png","fileUri":"https://bucket.r2.cloudflarestorage.com/cat.png?signature=2"}}
		]}]
	}`)
	fetches := 0
	rewritten, changed, err := rewriteGeminiRemoteFileData(context.Background(), body, func(_ context.Context, sourceURL string) (*geminiRemoteImage, error) {
		fetches++
		return &geminiRemoteImage{data: []byte("image-bytes"), contentType: "image/png"}, nil
	})
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, 2, fetches)

	var payload map[string]any
	require.NoError(t, json.Unmarshal(rewritten, &payload))
	parts := payload["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	require.Contains(t, parts[1].(map[string]any), "inlineData")
	require.NotContains(t, parts[1].(map[string]any), "fileData")
	require.Equal(t, "aW1hZ2UtYnl0ZXM=", parts[1].(map[string]any)["inlineData"].(map[string]any)["data"])
}

func TestRewriteGeminiRemoteFileDataLeavesNonR2URLsUntouched(t *testing.T) {
	body := []byte(`{
		"contents":[{"role":"user","parts":[
			{"fileData":{"mimeType":"image/png","fileUri":"https://example.com/reference.png"}}
		]}]
	}`)
	rewritten, changed, err := rewriteGeminiRemoteFileData(context.Background(), body, func(context.Context, string) (*geminiRemoteImage, error) {
		t.Fatal("non-R2 URL must not be fetched")
		return nil, nil
	})
	require.NoError(t, err)
	require.False(t, changed)
	require.Equal(t, body, rewritten)
}

func TestRewriteGeminiRemoteFileDataFallsBackWhenFetchFails(t *testing.T) {
	body := []byte(`{
		"contents":[{"role":"user","parts":[
			{"fileData":{"mimeType":"image/png","fileUri":"https://bucket.r2.cloudflarestorage.com/room.png"}}
		]}]
	}`)
	rewritten, changed, err := rewriteGeminiRemoteFileData(context.Background(), body, func(context.Context, string) (*geminiRemoteImage, error) {
		return nil, context.DeadlineExceeded
	})
	require.NoError(t, err)
	require.False(t, changed)
	require.Equal(t, body, rewritten)
}
