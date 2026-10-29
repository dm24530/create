package repository

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestUsageLogImageLinkStoreUpsert(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	store := NewUsageLogImageLinkStore(db)
	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO usage_log_image_links (
			user_id, api_key_id, request_id, link_token, image_url, object_key, expires_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		ON CONFLICT (user_id, api_key_id, request_id) DO UPDATE
		SET link_token = EXCLUDED.link_token,
		    image_url = EXCLUDED.image_url,
		    object_key = EXCLUDED.object_key,
		    expires_at = EXCLUDED.expires_at,
		    updated_at = NOW()
	`)).
		WithArgs(int64(7), int64(9), "client:req-1", sqlmock.AnyArg(), "https://cdn.example.test/image.png", "images/out.png", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, store.Upsert(context.Background(), &service.UsageLogImageLink{
		UserID:    7,
		APIKeyID:  9,
		RequestID: "client:req-1",
		ImageURL:  "https://cdn.example.test/image.png",
		ObjectKey: "images/out.png",
		ExpiresAt: time.Now().Add(time.Hour),
	}))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUsageLogImageLinkTokenIsRandomAndOpaque(t *testing.T) {
	first := newUsageLogImageLinkToken()
	second := newUsageLogImageLinkToken()

	require.Len(t, first, 32)
	require.Len(t, second, 32)
	require.NotEqual(t, first, second)
	require.Regexp(t, `^[a-f0-9]{32}$`, first)
}

func TestUsageLogImageLinkStoreMarkDisplayedIsIdempotent(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	store := NewUsageLogImageLinkStore(db)
	displayedAt := time.Now().UTC()

	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE usage_log_image_links
		SET displayed_at = COALESCE(displayed_at, $4),
		    updated_at = NOW()
		WHERE user_id = $1 AND api_key_id = $2 AND request_id = $3
	`)).
		WithArgs(int64(7), int64(9), "client:req-1", displayedAt).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, store.MarkDisplayed(
		context.Background(),
		7,
		9,
		"client:req-1",
		displayedAt,
	))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUsageLogImageLinkStoreMarkGenerationDuration(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	store := NewUsageLogImageLinkStore(db)

	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO image_generation_metrics (
			user_id, api_key_id, request_id, generation_duration_ms, completed_at
		)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, api_key_id, request_id) DO UPDATE
		SET generation_duration_ms = COALESCE(
		        image_generation_metrics.generation_duration_ms,
		        EXCLUDED.generation_duration_ms
		    ),
		    completed_at = COALESCE(image_generation_metrics.completed_at, EXCLUDED.completed_at),
		    updated_at = NOW()
	`)).
		WithArgs(int64(7), int64(9), "client:req-1", 71000).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE usage_log_image_links
		SET generation_duration_ms = COALESCE(generation_duration_ms, $4),
		    updated_at = NOW()
		WHERE user_id = $1 AND api_key_id = $2 AND request_id = $3
	`)).
		WithArgs(int64(7), int64(9), "client:req-1", 71000).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, store.MarkGenerationDuration(
		context.Background(),
		7,
		9,
		"client:req-1",
		71000,
	))
	require.NoError(t, mock.ExpectationsWereMet())
}
