package repository

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

func TestS3ImageStoragePresignPutSignsContentType(t *testing.T) {
	storage, err := NewS3ImageStorage(context.Background(), &config.ImageStorageConfig{
		Endpoint:        "https://account.r2.cloudflarestorage.com",
		Region:          "auto",
		Bucket:          "images",
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
		PublicBaseURL:   "https://images.example.com",
		PresignExpiry:   1,
	})
	require.NoError(t, err)

	upload, err := storage.PresignPut(
		context.Background(),
		"canvas/key/project/assets/asset.png",
		"image/png",
		10*time.Minute,
	)
	require.NoError(t, err)
	require.Equal(t, "image/png", upload.Headers["Content-Type"])
	require.NotContains(t, upload.Headers, "Cache-Control")

	parsed, err := url.Parse(upload.URL)
	require.NoError(t, err)
	require.Contains(t, parsed.Host, "account.r2.cloudflarestorage.com")
	require.Equal(t, "/canvas/key/project/assets/asset.png", parsed.Path)
	require.NotEmpty(t, parsed.Query().Get("X-Amz-Signature"))
	require.Equal(t, "600", parsed.Query().Get("X-Amz-Expires"))
	require.NotEmpty(t, parsed.Query().Get("X-Amz-SignedHeaders"))
}

func TestS3ImageStoragePresignGetDownloadSupportsPublicBaseURL(t *testing.T) {
	storage, err := NewS3ImageStorage(context.Background(), &config.ImageStorageConfig{
		Endpoint:        "https://account.r2.cloudflarestorage.com",
		Region:          "auto",
		Bucket:          "images",
		AccessKeyID:     "test-access-key",
		SecretAccessKey: "test-secret-key",
		PublicBaseURL:   "https://images.example.com",
		PresignExpiry:   1,
	})
	require.NoError(t, err)

	rawURL, err := storage.PresignGetDownload(
		context.Background(),
		"users/42/image.png",
		"image-42.png",
	)
	require.NoError(t, err)

	parsed, err := url.Parse(rawURL)
	require.NoError(t, err)
	require.Contains(t, parsed.Host, "account.r2.cloudflarestorage.com")
	require.Equal(t, "/users/42/image.png", parsed.Path)
	require.NotEmpty(t, parsed.Query().Get("X-Amz-Signature"))
	require.Contains(t, parsed.Query().Get("response-content-disposition"), "attachment")
}
