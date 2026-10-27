package handler

import (
	"context"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestGatewayHandlerRecordsSyncGeminiUsageImageLink(t *testing.T) {
	store := &asyncImageLinkStore{}
	h := &GatewayHandler{imageLinks: store}
	ctx := context.WithValue(context.Background(), ctxkey.ClientRequestID, "sync-image-request")

	h.recordUsageImageLink(ctx, &service.APIKey{ID: 9, UserID: 7}, &service.ForwardResult{
		ImageOutputs: []service.GeminiImageOutput{{
			URL:      "https://img.example.test/generated.jpg",
			MIMEType: "image/jpeg",
		}},
	})

	require.NotNil(t, store.link)
	require.Equal(t, "client:sync-image-request", store.link.RequestID)
	require.Equal(t, int64(7), store.link.UserID)
	require.Equal(t, int64(9), store.link.APIKeyID)
	require.Equal(t, "https://img.example.test/generated.jpg", store.link.ImageURL)
}

func TestGatewayHandlerRecordsSyncGeminiInlineImageAsDataURL(t *testing.T) {
	store := &asyncImageLinkStore{}
	h := &GatewayHandler{imageLinks: store}
	ctx := context.WithValue(context.Background(), ctxkey.RequestID, "local-image-request")

	h.recordUsageImageLink(ctx, &service.APIKey{ID: 9, UserID: 7}, &service.ForwardResult{
		ImageOutputs: []service.GeminiImageOutput{{
			Base64:   "YWJj",
			MIMEType: "image/png",
		}},
	})

	require.NotNil(t, store.link)
	require.Equal(t, "local:local-image-request", store.link.RequestID)
	require.Equal(t, "data:image/png;base64,YWJj", store.link.ImageURL)
}

func TestUsageImageObjectKeyUsesOpaqueUserNamespace(t *testing.T) {
	first := usageImageObjectKey("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "client:req-1", "image/png")
	second := usageImageObjectKey("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "client:req-1", "image/png")

	require.True(t, strings.HasPrefix(first, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/usage-"))
	require.True(t, strings.HasPrefix(second, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/usage-"))
	require.NotEqual(t, first, second)
	require.NotContains(t, first, "users/")
	require.NotContains(t, first, "client:req-1")
	require.True(t, strings.HasSuffix(first, ".png"))
}
