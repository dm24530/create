//go:build unit

package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

func resetCanvasAdminOnlyTestCache(t *testing.T) {
	t.Helper()
	canvasAdminOnlyCache.Store((*cachedCanvasAdminOnly)(nil))
	t.Cleanup(func() {
		canvasAdminOnlyCache.Store((*cachedCanvasAdminOnly)(nil))
	})
}

func TestIsCanvasAdminOnlyDefaultsClosed(t *testing.T) {
	resetCanvasAdminOnlyTestCache(t)
	repo := &bmRepoStub{
		getValueFn: func(_ context.Context, key string) (string, error) {
			require.Equal(t, SettingKeyCanvasAdminOnly, key)
			return "", ErrSettingNotFound
		},
	}
	svc := NewSettingService(repo, &config.Config{})

	require.True(t, svc.IsCanvasAdminOnly(context.Background()))
	require.Equal(t, 1, repo.calls)
}

func TestIsCanvasAdminOnlyReadsExplicitFalse(t *testing.T) {
	resetCanvasAdminOnlyTestCache(t)
	repo := &bmRepoStub{
		getValueFn: func(_ context.Context, key string) (string, error) {
			require.Equal(t, SettingKeyCanvasAdminOnly, key)
			return "false", nil
		},
	}
	svc := NewSettingService(repo, &config.Config{})

	require.False(t, svc.IsCanvasAdminOnly(context.Background()))
}

func TestIsCanvasAdminOnlyFailsClosedOnDatabaseError(t *testing.T) {
	resetCanvasAdminOnlyTestCache(t)
	repo := &bmRepoStub{
		getValueFn: func(_ context.Context, key string) (string, error) {
			require.Equal(t, SettingKeyCanvasAdminOnly, key)
			return "", errors.New("db down")
		},
	}
	svc := NewSettingService(repo, &config.Config{})

	require.True(t, svc.IsCanvasAdminOnly(context.Background()))
}

func TestIsCanvasAdminOnlyCachesResult(t *testing.T) {
	resetCanvasAdminOnlyTestCache(t)
	repo := &bmRepoStub{
		getValueFn: func(_ context.Context, key string) (string, error) {
			require.Equal(t, SettingKeyCanvasAdminOnly, key)
			return "false", nil
		},
	}
	svc := NewSettingService(repo, &config.Config{})

	require.False(t, svc.IsCanvasAdminOnly(context.Background()))
	require.False(t, svc.IsCanvasAdminOnly(context.Background()))
	require.Equal(t, 1, repo.calls)
}
