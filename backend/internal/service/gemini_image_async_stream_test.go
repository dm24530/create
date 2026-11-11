package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/tlsfingerprint"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGeminiAsyncStreamingOptInUsesStreamAndStopsAtImage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"image/jpeg\",\"data\":\"aW1hZ2U=\"}}]},\"finishReason\":\"STOP\"}]}\n\n")
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &GeminiMessagesCompatService{
		httpUpstream: geminiImageAsyncStreamUpstream{client: upstream.Client()},
		cfg:          cfg,
	}
	account := geminiImageAsyncStreamAccount(upstream.URL, true)
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
	require.NotContains(t, rec.Body.String(), "data: {")
}

func TestGeminiAsyncStreamingRequiresAccountOptIn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/jpeg","data":"aW1hZ2U="}}]},"finishReason":"STOP"}]}`)
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &GeminiMessagesCompatService{
		httpUpstream: geminiImageAsyncStreamUpstream{client: upstream.Client()},
		cfg:          cfg,
	}
	account := geminiImageAsyncStreamAccount(upstream.URL, false)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/v1beta/models/gemini-3-pro-image:generateContent",
		strings.NewReader("{}"),
	)
	ctx := context.WithValue(context.Background(), ctxkey.AsyncImageTask, true)

	_, err := svc.ForwardNative(
		ctx,
		c,
		account,
		"gemini-3-pro-image",
		"generateContent",
		false,
		[]byte(`{"generationConfig":{"responseModalities":["TEXT","IMAGE"]}}`),
	)
	require.NoError(t, err)
	require.Contains(t, gotPath, ":generateContent")
	require.NotContains(t, gotPath, ":streamGenerateContent")
}

func TestGeminiStreamingOptInDoesNotAffectSyncRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/jpeg","data":"aW1hZ2U="}}]},"finishReason":"STOP"}]}`)
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &GeminiMessagesCompatService{
		httpUpstream: geminiImageAsyncStreamUpstream{client: upstream.Client()},
		cfg:          cfg,
	}
	account := geminiImageAsyncStreamAccount(upstream.URL, true)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/v1beta/models/gemini-3-pro-image:generateContent",
		strings.NewReader("{}"),
	)

	_, err := svc.ForwardNative(
		context.Background(),
		c,
		account,
		"gemini-3-pro-image",
		"generateContent",
		false,
		[]byte(`{"generationConfig":{"responseModalities":["TEXT","IMAGE"]}}`),
	)
	require.NoError(t, err)
	require.Contains(t, gotPath, ":generateContent")
	require.NotContains(t, gotPath, ":streamGenerateContent")
}

func geminiImageAsyncStreamAccount(baseURL string, streamingEnabled bool) *Account {
	extra := map[string]any{}
	if streamingEnabled {
		extra[AccountExtraGeminiAsyncStreamingEnabled] = true
	}
	return &Account{
		ID:       42,
		Platform: PlatformGemini,
		Type:     AccountTypeAPIKey,
		Extra:    extra,
		Credentials: map[string]any{
			"api_key":  "test-key",
			"base_url": baseURL,
		},
	}
}

type geminiImageAsyncStreamUpstream struct {
	client *http.Client
}

func (u geminiImageAsyncStreamUpstream) Do(
	req *http.Request,
	_ string,
	_ int64,
	_ int,
) (*http.Response, error) {
	return u.client.Do(req)
}

func (u geminiImageAsyncStreamUpstream) DoWithTLS(
	req *http.Request,
	proxyURL string,
	accountID int64,
	accountConcurrency int,
	_ *tlsfingerprint.Profile,
) (*http.Response, error) {
	return u.Do(req, proxyURL, accountID, accountConcurrency)
}
