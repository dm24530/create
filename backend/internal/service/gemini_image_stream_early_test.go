package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/tlsfingerprint"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCollectGeminiSSEObservedStopsAfterInlineImage(t *testing.T) {
	event := "data: {\"candidates\":[{\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"image/png\",\"data\":\"aW1hZ2U=\"}}]}}]}\n\n"
	reader := io.MultiReader(iotest.OneByteReader(strings.NewReader(event)), failingReader{})

	_, _, _, err := collectGeminiSSEObservedUntilImage(reader, false, true, nil)
	require.NoError(t, err)
}

func TestGeminiInlineImageEventDetection(t *testing.T) {
	payload := strings.NewReader(
		"data: {\"candidates\":[{\"content\":{\"parts\":[{\"inline_data\":{\"mime_type\":\"image/jpeg\",\"data\":\"aW1hZ2U=\"}}]}}]}\n\n",
	)
	collected, _, stats, err := collectGeminiSSEObservedUntilImage(payload, false, true, nil)
	require.NoError(t, err)
	require.Equal(t, 1, stats.dataEvents)
	require.NotEmpty(t, collected)
}

func TestGeminiForwardNativeAsyncImageStreamsAndStopsAtFirstImage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"image/png\",\"data\":\"aW1hZ2U=\"}}]}}]}\n\n")
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &GeminiMessagesCompatService{
		httpUpstream: geminiEarlyHTTPUpstream{client: upstream.Client()},
		cfg:          cfg,
	}
	account := &Account{
		ID:       42,
		Platform: PlatformGemini,
		Type:     AccountTypeAPIKey,
		Credentials: map[string]any{
			"api_key":  "test-key",
			"base_url": upstream.URL,
		},
	}
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/v1beta/models/gemini-3-pro-image:generateContent",
		strings.NewReader("{}"),
	)
	ctx := context.WithValue(context.Background(), ctxkey.AsyncImageTask, true)

	started := time.Now()
	result, err := svc.ForwardNative(
		ctx,
		c,
		account,
		"gemini-3-pro-image",
		"generateContent",
		false,
		[]byte(`{"generationConfig":{"responseModalities":["TEXT","IMAGE"]}}`),
	)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Less(t, time.Since(started), time.Second)
	require.Contains(t, gotPath, ":streamGenerateContent")
	require.Contains(t, rec.Body.String(), `"inlineData"`)
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) {
	return 0, errors.New("reader continued after inline image")
}

type geminiEarlyHTTPUpstream struct {
	client *http.Client
}

func (u geminiEarlyHTTPUpstream) Do(
	req *http.Request,
	_ string,
	_ int64,
	_ int,
) (*http.Response, error) {
	return u.client.Do(req)
}

func (u geminiEarlyHTTPUpstream) DoWithTLS(
	req *http.Request,
	proxyURL string,
	accountID int64,
	accountConcurrency int,
	_ *tlsfingerprint.Profile,
) (*http.Response, error) {
	return u.Do(req, proxyURL, accountID, accountConcurrency)
}
