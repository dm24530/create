package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/tlsfingerprint"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestOpenAIImagesAsyncOptInForcesStreamingAndAggregatesJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotStream bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		gotStream = gjsonGetBool(body, "stream")
		if !gotStream {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"created":1,"data":[{"b64_json":"bm9uLXN0cmVhbQ=="}]}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"type\":\"image_generation.completed\",\"b64_json\":\"ZmluYWw=\",\"output_format\":\"png\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3,\"output_tokens_details\":{\"image_tokens\":2}}}\n\n")
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &OpenAIGatewayService{
		cfg:          cfg,
		httpUpstream: openAIImageAsyncStreamUpstream{client: upstream.Client()},
	}
	account := &Account{
		ID:          42,
		Platform:    PlatformOpenAI,
		Type:        AccountTypeAPIKey,
		Concurrency: 100,
		Extra: map[string]any{
			AccountExtraImagesAsyncStreamingEnabled: true,
		},
		Credentials: map[string]any{
			"api_key":  "test-key",
			"base_url": upstream.URL,
		},
	}
	body := []byte(`{"model":"gpt-image-2-6","prompt":"draw a dog","response_format":"b64_json"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	parsed, err := svc.ParseOpenAIImagesRequest(c, body)
	require.NoError(t, err)

	ctx := context.WithValue(context.Background(), ctxkey.AsyncImageTask, true)
	result, err := svc.ForwardImages(ctx, c, account, body, parsed, "")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.True(t, gotStream)
	require.Equal(t, 1, result.ImageCount)
	require.Contains(t, rec.Body.String(), `"b64_json":"ZmluYWw="`)
	require.NotContains(t, rec.Body.String(), "image_generation.completed")
}

func TestOpenAIImagesAsyncOptInDoesNotAffectSyncRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotStream bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		gotStream = gjsonGetBool(body, "stream")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"created":1,"data":[{"b64_json":"ZmluYWw="}]}`)
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &OpenAIGatewayService{
		cfg:          cfg,
		httpUpstream: openAIImageAsyncStreamUpstream{client: upstream.Client()},
	}
	account := &Account{
		ID:       42,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		Extra: map[string]any{
			AccountExtraImagesAsyncStreamingEnabled: true,
		},
		Credentials: map[string]any{
			"api_key":  "test-key",
			"base_url": upstream.URL,
		},
	}
	body := []byte(`{"model":"gpt-image-2-6","prompt":"draw a dog","response_format":"b64_json"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	parsed, err := svc.ParseOpenAIImagesRequest(c, body)
	require.NoError(t, err)

	_, err = svc.ForwardImages(context.Background(), c, account, body, parsed, "")
	require.NoError(t, err)
	require.False(t, gotStream)
}

func TestOpenAIImagesAsyncWithoutOptInKeepsNonStreaming(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotStream bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		gotStream = gjsonGetBool(body, "stream")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"created":1,"data":[{"b64_json":"ZmluYWw="}]}`)
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &OpenAIGatewayService{
		cfg:          cfg,
		httpUpstream: openAIImageAsyncStreamUpstream{client: upstream.Client()},
	}
	account := &Account{
		ID:       42,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		Credentials: map[string]any{
			"api_key":  "test-key",
			"base_url": upstream.URL,
		},
	}
	body := []byte(`{"model":"gpt-image-2","prompt":"draw a dog","response_format":"b64_json"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	parsed, err := svc.ParseOpenAIImagesRequest(c, body)
	require.NoError(t, err)

	ctx := context.WithValue(context.Background(), ctxkey.AsyncImageTask, true)
	_, err = svc.ForwardImages(ctx, c, account, body, parsed, "")
	require.NoError(t, err)
	require.False(t, gotStream)
}

func TestOpenAIImagesAsyncStreamingFallsBackWhenUpstreamStreamIsEmpty(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var streamModes []bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		stream := gjsonGetBool(body, "stream")
		streamModes = append(streamModes, stream)
		if stream {
			w.Header().Set("Content-Type", "text/event-stream")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"created":1,"data":[{"b64_json":"ZmFsbGJhY2s="}]}`)
	}))
	defer upstream.Close()

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	svc := &OpenAIGatewayService{
		cfg:          cfg,
		httpUpstream: openAIImageAsyncStreamUpstream{client: upstream.Client()},
	}
	account := &Account{
		ID:       42,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		Extra: map[string]any{
			AccountExtraImagesAsyncStreamingEnabled: true,
		},
		Credentials: map[string]any{
			"api_key":  "test-key",
			"base_url": upstream.URL,
		},
	}
	body := []byte(`{"model":"gpt-image-2-5-sunburst","prompt":"draw a dog","response_format":"b64_json"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	parsed, err := svc.ParseOpenAIImagesRequest(c, body)
	require.NoError(t, err)

	ctx := context.WithValue(context.Background(), ctxkey.AsyncImageTask, true)
	result, err := svc.ForwardImages(ctx, c, account, body, parsed, "")
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Equal(t, []bool{true, false}, streamModes)
	require.Contains(t, rec.Body.String(), `"b64_json":"ZmFsbGJhY2s="`)
}

func gjsonGetBool(body []byte, path string) bool {
	return gjson.GetBytes(body, path).Bool()
}

type openAIImageAsyncStreamUpstream struct {
	client *http.Client
}

func (u openAIImageAsyncStreamUpstream) Do(
	req *http.Request,
	_ string,
	_ int64,
	_ int,
) (*http.Response, error) {
	return u.client.Do(req)
}

func (u openAIImageAsyncStreamUpstream) DoWithTLS(
	req *http.Request,
	proxyURL string,
	accountID int64,
	accountConcurrency int,
	_ *tlsfingerprint.Profile,
) (*http.Response, error) {
	return u.Do(req, proxyURL, accountID, accountConcurrency)
}
