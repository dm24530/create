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

func TestGatewayHandlerSkipsInlineImageWithoutObjectStorage(t *testing.T) {
	store := &asyncImageLinkStore{}
	h := &GatewayHandler{imageLinks: store}
	ctx := context.WithValue(context.Background(), ctxkey.RequestID, "local-image-request")

	h.recordUsageImageLink(ctx, &service.APIKey{ID: 9, UserID: 7}, &service.ForwardResult{
		ImageOutputs: []service.GeminiImageOutput{{
			Base64:   "YWJj",
			MIMEType: "image/png",
		}},
	})

	require.Nil(t, store.link)
}

func TestOpenAIGatewayHandlerRecordsSyncUsageImageLink(t *testing.T) {
	store := &asyncImageLinkStore{}
	h := &OpenAIGatewayHandler{imageLinks: store}
	ctx := context.WithValue(context.Background(), ctxkey.ClientRequestID, "openai-sync-image")

	h.recordUsageImageLink(ctx, &service.APIKey{ID: 11, UserID: 7}, "upstream-request", []service.GeminiImageOutput{{
		URL:      "https://img.example.test/openai-generated.png",
		MIMEType: "image/png",
	}})

	require.NotNil(t, store.link)
	require.Equal(t, "client:openai-sync-image", store.link.RequestID)
	require.Equal(t, int64(7), store.link.UserID)
	require.Equal(t, int64(11), store.link.APIKeyID)
	require.Equal(t, "https://img.example.test/openai-generated.png", store.link.ImageURL)
}

func TestRecordUsageImageOutputsFallsBackToLocalAsset(t *testing.T) {
	store := &asyncImageLinkStore{}
	localAssets := service.NewLocalImageAssetStore(t.TempDir())
	ctx := context.WithValue(context.Background(), ctxkey.ClientRequestID, "sync-local-fallback")

	recordUsageImageOutputs(ctx, &service.APIKey{ID: 11, UserID: 7}, "upstream-request",
		[]service.GeminiImageOutput{{
			Base64:   "YWJj",
			MIMEType: "image/png",
		}}, store, nil, localAssets)

	require.NotNil(t, store.link)
	require.Equal(t, "client:sync-local-fallback", store.link.RequestID)
	require.True(t, strings.HasPrefix(store.link.ImageURL, service.LocalImageAssetURLPrefix))

	assetID, ok := localAssets.AssetIDFromURL(store.link.ImageURL)
	require.True(t, ok)
	_, data, err := localAssets.Read(assetID)
	require.NoError(t, err)
	require.Equal(t, []byte("abc"), data)
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

func TestNormalizedUsageImageContentTypeUsesActualImageBytes(t *testing.T) {
	pngHeader := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}

	require.Equal(t, "image/png", normalizedUsageImageContentType(pngHeader, "image/jpeg"))
	require.Equal(t, "image/webp", normalizedUsageImageContentType(nil, "image/webp"))
}
