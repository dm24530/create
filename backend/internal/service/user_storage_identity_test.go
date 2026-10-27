//go:build unit

package service

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestUserStorageIdentityServiceLoadsAndCachesKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	key := "0123456789abcdef0123456789abcdef"
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT storage_key FROM users WHERE id = $1`)).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"storage_key"}).AddRow(key))

	svc := NewUserStorageIdentityService(db)
	got, err := svc.StorageKey(context.Background(), 42)
	require.NoError(t, err)
	require.Equal(t, key, got)

	got, err = svc.StorageKey(context.Background(), 42)
	require.NoError(t, err)
	require.Equal(t, key, got, "a successful lookup must be cached")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUserStorageIdentityServiceAssignsMissingKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT storage_key FROM users WHERE id = $1`)).
		WithArgs(int64(7)).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`UPDATE users\s+SET storage_key = \$2`).
		WithArgs(int64(7), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"storage_key"}).AddRow("abcdefabcdefabcdefabcdefabcdefab"))

	svc := NewUserStorageIdentityService(db)
	got, err := svc.StorageKey(context.Background(), 7)
	require.NoError(t, err)
	require.Equal(t, "abcdefabcdefabcdefabcdefabcdefab", got)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUserStorageIdentityServiceRejectsInvalidInput(t *testing.T) {
	svc := NewUserStorageIdentityService(nil)
	_, err := svc.StorageKey(context.Background(), 1)
	require.ErrorIs(t, err, ErrUserStorageKeyUnavailable)
}
