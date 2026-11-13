package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestSanitizeGeminiResponseFileDataInlinesRemoteFile(t *testing.T) {
	body := []byte(`{
		"candidates":[{"content":{"parts":[
			{"text":"generated"},
			{"fileData":{"mimeType":"image/png","fileUri":"https://storage.googleapis.com/generated.png?signature=1"}}
		]}}]
	}`)
	fetches := 0
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, func(_ context.Context, sourceURL string) (*geminiRemoteImage, error) {
		fetches++
		require.Equal(t, "https://storage.googleapis.com/generated.png?signature=1", sourceURL)
		return &geminiRemoteImage{data: []byte("image-bytes"), contentType: "image/png"}, nil
	})
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, 1, fetches)
	require.NotContains(t, string(rewritten), "storage.googleapis.com")
	require.NotContains(t, string(rewritten), "fileUri")

	var payload map[string]any
	require.NoError(t, json.Unmarshal(rewritten, &payload))
	parts := payload["candidates"].([]any)[0].(map[string]any)["content"].(map[string]any)["parts"].([]any)
	require.Equal(t, "aW1hZ2UtYnl0ZXM=", parts[1].(map[string]any)["inlineData"].(map[string]any)["data"])
}

func TestSanitizeGeminiResponseFileDataRemovesPartWhenFetchFails(t *testing.T) {
	body := []byte(`{
		"candidates":[{"content":{"parts":[
			{"text":"generated"},
			{"file_data":{"mime_type":"image/png","file_uri":"https://storage.googleapis.com/generated.png"}}
		]}}]
	}`)
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, func(context.Context, string) (*geminiRemoteImage, error) {
		return nil, errors.New("download failed")
	})
	require.NoError(t, err)
	require.True(t, changed)
	require.NotContains(t, string(rewritten), "storage.googleapis.com")
	require.NotContains(t, string(rewritten), "file_data")

	var payload map[string]any
	require.NoError(t, json.Unmarshal(rewritten, &payload))
	parts := payload["candidates"].([]any)[0].(map[string]any)["content"].(map[string]any)["parts"].([]any)
	require.Len(t, parts, 1)
	require.Equal(t, "generated", parts[0].(map[string]any)["text"])
}

func TestSanitizeGeminiResponseFileDataKeepsNormalTextURL(t *testing.T) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"text":"source: https://example.com/article"}]}}]}`)
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, nil)
	require.NoError(t, err)
	require.False(t, changed)
	require.Equal(t, body, rewritten)
}

func TestSanitizeGeminiResponseFileDataInlinesImageURLFromText(t *testing.T) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"text":"preview: https://storage.googleapis.com/generated.png source: https://example.com/article"}]}}]}`)
	fetches := 0
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, func(_ context.Context, sourceURL string) (*geminiRemoteImage, error) {
		fetches++
		require.Equal(t, "https://storage.googleapis.com/generated.png", sourceURL)
		return &geminiRemoteImage{data: []byte("image-bytes"), contentType: "image/png"}, nil
	})
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, 1, fetches)
	require.NotContains(t, string(rewritten), "storage.googleapis.com")
	require.Contains(t, string(rewritten), "https://example.com/article")
	require.Contains(t, string(rewritten), `"inlineData"`)
	require.Contains(t, string(rewritten), "aW1hZ2UtYnl0ZXM=")
}

func TestSanitizeGeminiResponseFileDataRemovesTextImageURLWhenFetchFails(t *testing.T) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"text":"preview: https://storage.googleapis.com/generated.png"}]}}]}`)
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, func(context.Context, string) (*geminiRemoteImage, error) {
		return nil, errors.New("download failed")
	})
	require.NoError(t, err)
	require.True(t, changed)
	require.NotContains(t, string(rewritten), "storage.googleapis.com")
	require.NotContains(t, string(rewritten), `"inlineData"`)
}

func TestSanitizeGeminiResponseFileDataCapsMediaFetches(t *testing.T) {
	urls := make([]string, 0, geminiRemoteResponseFileMaxParts+3)
	for i := 0; i < geminiRemoteResponseFileMaxParts+3; i++ {
		urls = append(urls, fmt.Sprintf("https://storage.googleapis.com/%d.png", i))
	}
	body, err := json.Marshal(map[string]any{
		"candidates": []any{map[string]any{
			"content": map[string]any{
				"parts": []any{map[string]any{"text": strings.Join(urls, " ")}},
			},
		}},
	})
	require.NoError(t, err)

	fetches := 0
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, func(_ context.Context, sourceURL string) (*geminiRemoteImage, error) {
		fetches++
		return &geminiRemoteImage{data: []byte(sourceURL), contentType: "image/png"}, nil
	})
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, geminiRemoteResponseFileMaxParts, fetches)
	require.NotContains(t, string(rewritten), "storage.googleapis.com")
}

func TestSanitizeGeminiResponseFileDataRedactsMalformedFileURI(t *testing.T) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"fileData":{"fileUri":"https://storage.googleapis.com/generated.png"}}]}]}`)
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, nil)
	require.Error(t, err)
	require.True(t, changed)
	require.False(t, strings.Contains(string(rewritten), "storage.googleapis.com"))
	require.Contains(t, string(rewritten), `"fileUri":""`)
}

func TestSanitizeGeminiResponseFileDataRedactsMalformedTextImageURL(t *testing.T) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"text":"https://storage.googleapis.com/generated.png"}]}]}`)
	rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, nil)
	require.Error(t, err)
	require.True(t, changed)
	require.NotContains(t, string(rewritten), "storage.googleapis.com")
}

func TestDownloadGeminiRemoteFileMarksPublicHostsOnly(t *testing.T) {
	var publicHostsOnly bool
	media, err := downloadGeminiRemoteFileWith(
		context.Background(),
		"https://storage.googleapis.com/generated.png",
		func(req *http.Request) (*http.Response, error) {
			publicHostsOnly = HTTPUpstreamPublicHostsOnly(req.Context())
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"image/png"}},
				Body:       io.NopCloser(strings.NewReader("image-bytes")),
			}, nil
		},
		geminiRemoteResponseFileMaxBytes,
	)
	require.NoError(t, err)
	require.True(t, publicHostsOnly)
	require.Equal(t, []byte("image-bytes"), media.data)
}

func TestDownloadGeminiRemoteFileForceFetchSmoke(t *testing.T) {
	payload := bytes.Repeat([]byte("x"), 1<<20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	media, err := downloadGeminiRemoteFileWith(
		context.Background(),
		server.URL+"/generated.png",
		http.DefaultClient.Do,
		geminiRemoteResponseFileMaxBytes,
	)
	require.NoError(t, err)
	require.Equal(t, "image/png", media.contentType)
	require.Equal(t, payload, media.data)
}

func TestSanitizeGeminiResponseFileDataStress(t *testing.T) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"text":"https://storage.googleapis.com/generated.png"}]}}]}`)
	const workers = 64
	const iterations = 50
	start := time.Now()
	errCh := make(chan error, workers)
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, func(context.Context, string) (*geminiRemoteImage, error) {
					return &geminiRemoteImage{data: []byte("image-bytes"), contentType: "image/png"}, nil
				})
				if err != nil {
					errCh <- err
					return
				}
				if !changed || strings.Contains(string(rewritten), "storage.googleapis.com") {
					errCh <- errors.New("stress iteration leaked upstream URL or did not sanitize")
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		require.NoError(t, err)
	}
	t.Logf("sanitized %d responses in %s", workers*iterations, time.Since(start))
}

func BenchmarkSanitizeGeminiResponseFileData4MB(b *testing.B) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"fileData":{"mimeType":"image/png","fileUri":"https://storage.googleapis.com/generated.png"}}]}}]}`)
	payload := bytes.Repeat([]byte("x"), 4<<20)
	b.ReportAllocs()
	b.SetBytes(int64(len(payload)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rewritten, changed, err := sanitizeGeminiResponseFileData(context.Background(), body, func(context.Context, string) (*geminiRemoteImage, error) {
			return &geminiRemoteImage{data: payload, contentType: "image/png"}, nil
		})
		if err != nil {
			b.Fatal(err)
		}
		if !changed || bytes.Contains(rewritten, []byte("storage.googleapis.com")) {
			b.Fatal("benchmark response leaked upstream URL or did not sanitize")
		}
	}
}
