package repository

import (
	"context"
	"net/url"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

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
