package repository

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestStudioWorksListScansNullableDuration(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	store := &studioWorksDB{db: db}
	saved := true
	mock.ExpectQuery(`(?s)SELECT.*sort_order.*FROM studio_works.*saved = TRUE.*saved = \$3.*ORDER BY sort_order DESC.*LIMIT \$4`).
		WithArgs(int64(7), "image", true, 100).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "user_id", "kind", "object_key", "url", "thumb_url", "thumb_object_key", "prompt", "model", "format", "size",
			"duration_seconds", "duration_ms", "saved", "sort_order", "created_at", "expires_at",
		}).AddRow(
			"work-1", int64(7), "image", "images/work-1.png", "https://cdn.test/work-1.png", "", "", "cat", "gpt-image-1",
			"png", "1024x1024", 0, nil, true, int64(900), int64(100), int64(0),
		))

	rows, err := store.list(context.Background(), 7, "image", &saved, 100)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.False(t, rows[0].DurationMs.Valid)
	require.NoError(t, mock.ExpectationsWereMet())
}
