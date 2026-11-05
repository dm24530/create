package repository

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestStudioWorksReconcileTemporaryExpiryCastsRetentionSeconds(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	store := &studioWorksDB{db: db}

	mock.ExpectExec(`(?s)UPDATE studio_works.*CASE WHEN kind = 'video' THEN \$2::bigint ELSE \$1::bigint END \* INTERVAL '1 second'.*WHERE saved = FALSE`).
		WithArgs(int64(86400), int64(604800)).
		WillReturnResult(sqlmock.NewResult(0, 2))

	affected, err := store.reconcileTemporaryExpiry(context.Background(), 86400, 604800)
	require.NoError(t, err)
	require.Equal(t, int64(2), affected)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestStudioWorksListScansNullableDuration(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	store := &studioWorksDB{db: db}
	saved := true
	mock.ExpectQuery(`(?s)SELECT.*sort_order.*FROM studio_works.*saved = TRUE.*saved = \$3.*ORDER BY.*CASE.*sort_order >= 100000000000000.*LIMIT \$4`).
		WithArgs(int64(7), "image", true, 100).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "user_id", "kind", "source_id", "object_key", "url", "thumb_url", "thumb_object_key", "prompt", "model", "format", "size",
			"duration_seconds", "duration_ms", "saved", "sort_order", "created_at", "expires_at",
		}).AddRow(
			"work-1", int64(7), "image", "", "images/work-1.png", "https://cdn.test/work-1.png", "", "", "cat", "gpt-image-1",
			"png", "1024x1024", 0, nil, true, int64(900), int64(100), int64(0),
		))

	rows, err := store.list(context.Background(), 7, "image", &saved, 100)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.False(t, rows[0].DurationMs.Valid)
	require.NoError(t, mock.ExpectationsWereMet())
}
