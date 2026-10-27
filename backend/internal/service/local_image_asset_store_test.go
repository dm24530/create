package service

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLocalImageAssetStorePersistsOriginalByOwner(t *testing.T) {
	store := NewLocalImageAssetStore(t.TempDir())

	first, err := store.Save(
		context.Background(),
		11,
		"task-1",
		"images/users/11/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		pngBytes,
	)
	require.NoError(t, err)
	second, err := store.Save(
		context.Background(),
		22,
		"task-2",
		"images/users/22/task-2-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		pngBytes,
	)
	require.NoError(t, err)

	require.NotEqual(t, first.ID, second.ID)
	require.Equal(t, int64(11), first.UserID)
	require.Equal(t, int64(22), second.UserID)
	require.Contains(t, first.FileName, "users/11/")
	require.Contains(t, second.FileName, "users/22/")

	id, ok := store.AssetIDFromURL(store.URL(first.ID) + "?download=1")
	require.True(t, ok)
	require.Equal(t, first.ID, id)
	_, ok = store.AssetIDFromURL(LocalImageAssetURLPrefix + "../users/11/file.png")
	require.False(t, ok)

	meta, data, err := store.Read(first.ID)
	require.NoError(t, err)
	require.Equal(t, first.ID, meta.ID)
	require.Equal(t, pngBytes, data)
}

func TestLocalImageAssetStoreMarkUploadedRemovesLocalOriginal(t *testing.T) {
	store := NewLocalImageAssetStore(t.TempDir())
	meta, err := store.Save(
		context.Background(),
		42,
		"task-1",
		"images/users/42/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		pngBytes,
	)
	require.NoError(t, err)
	path := store.assetPath(meta)

	require.NoError(t, store.MarkUploaded(meta.ID, "https://cdn.example.com/image.png"))

	got, err := store.Get(meta.ID)
	require.NoError(t, err)
	require.True(t, got.Uploaded)
	require.Equal(t, "https://cdn.example.com/image.png", got.RemoteURL)
	require.True(t, store.IsUploadedURL(store.URL(meta.ID)))
	_, err = os.Stat(path)
	require.True(t, os.IsNotExist(err))
	_, _, err = store.Read(meta.ID)
	require.ErrorIs(t, err, ErrLocalImageAssetNotFound)
}

func TestLocalImageAssetStoreListPendingSkipsUploadedAssets(t *testing.T) {
	store := NewLocalImageAssetStore(t.TempDir())
	pending, err := store.Save(context.Background(), 42, "pending", "images/p.png", "image/png", 0, pngBytes)
	require.NoError(t, err)
	uploaded, err := store.Save(context.Background(), 42, "uploaded", "images/u.png", "image/png", 0, pngBytes)
	require.NoError(t, err)
	require.NoError(t, store.MarkUploaded(uploaded.ID, "https://cdn.example.com/u.png"))

	items, err := store.ListPending(10)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, pending.ID, items[0].ID)

	require.NoError(t, store.DeleteByObjectKey("images/p.png"))
	_, err = store.Get(pending.ID)
	require.True(t, errors.Is(err, ErrLocalImageAssetNotFound))
}

func TestLocalImageAssetStoreUpdatesExpiryAndDeletesAsset(t *testing.T) {
	store := NewLocalImageAssetStore(t.TempDir())
	meta, err := store.Save(
		context.Background(),
		42,
		"task-1",
		"images/users/42/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		pngBytes,
	)
	require.NoError(t, err)

	require.NoError(t, store.SetExpiryByURL(store.URL(meta.ID), 0))
	updated, err := store.Get(meta.ID)
	require.NoError(t, err)
	require.Zero(t, updated.ExpiresAt)

	require.NoError(t, store.Delete(meta.ID))
	_, err = store.Get(meta.ID)
	require.ErrorIs(t, err, ErrLocalImageAssetNotFound)
}
