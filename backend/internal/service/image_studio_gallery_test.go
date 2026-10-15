//go:build unit

package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type galleryStoreStub struct {
	entries    []*ImageStudioGalleryEntry
	objectKeys map[string]string
	deleted    []string
}

func (s *galleryStoreStub) Save(_ context.Context, entry *ImageStudioGalleryEntry) error {
	s.entries = append(s.entries, entry)
	if s.objectKeys == nil {
		s.objectKeys = map[string]string{}
	}
	s.objectKeys[entry.ID] = entry.ObjectKey
	return nil
}

func (s *galleryStoreStub) List(context.Context, int64, int) ([]*ImageStudioGalleryEntry, error) {
	return s.entries, nil
}

func (s *galleryStoreStub) Count(_ context.Context, _ int64) (int64, error) {
	return int64(len(s.entries)), nil
}

func (s *galleryStoreStub) ObjectKey(_ context.Context, _ int64, id string) (string, error) {
	key, ok := s.objectKeys[id]
	if !ok {
		return "", ErrStudioWorkNotFound
	}
	return key, nil
}

func (s *galleryStoreStub) Delete(_ context.Context, _ int64, id string) error {
	s.deleted = append(s.deleted, id)
	return nil
}

type gallerySaverStub struct {
	key           string
	contentType   string
	data          []byte
	retention     time.Duration
	fetchData     []byte
	fetchType     string
	fetchErr      error
	fetchedURL    string
	deleteErr     error
	deletedObject []string
}

func (s *gallerySaverStub) SaveImageWithKey(
	_ context.Context, key, contentType string, data []byte,
) (string, string, error) {
	s.key = key
	s.contentType = contentType
	s.data = append([]byte(nil), data...)
	// 真实实现会加上配置的 Key 前缀，这里用一个固定前缀模拟，确保记录里存的是最终键。
	return "https://cdn.example.com/" + key, "images/" + key, nil
}

func (s *gallerySaverStub) FetchImageURL(_ context.Context, rawURL string) ([]byte, string, error) {
	s.fetchedURL = rawURL
	if s.fetchErr != nil {
		return nil, "", s.fetchErr
	}
	return s.fetchData, s.fetchType, nil
}

func (s *gallerySaverStub) GalleryRetention() time.Duration {
	if s.retention <= 0 {
		return ImageStudioGalleryTTL
	}
	return s.retention
}

func (s *gallerySaverStub) DeleteObject(_ context.Context, key string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	s.deletedObject = append(s.deletedObject, key)
	return nil
}

// 作品记录是永久的：不再写过期时间，但要记下 object_key，删除时才知道删哪个文件。
func TestImageStudioGallerySaveKeepsWorkPermanently(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)

	entry, err := svc.Save(
		context.Background(),
		42,
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		"image/png",
		smallPNG(t),
	)
	require.NoError(t, err)
	require.Equal(t, int64(42), entry.UserID)
	require.Equal(t, entry.ID+".png", saver.key)
	require.NotContains(t, saver.key, "42/", "object key must not include the user id as a path segment")
	require.Equal(t, "image/png", saver.contentType)
	require.Len(t, saver.data, len(smallPNG(t)))
	require.Equal(t, int64(0), entry.ExpiresAt, "作品不再有过期时间")
	require.Equal(t, "images/"+entry.ID+".png", entry.ObjectKey, "记录里必须存最终对象键（带前缀）")
	require.Len(t, store.entries, 1)
}

func TestImageStudioGallerySaveFromURLStoresServerFetchedBytes(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{fetchData: smallPNG(t), fetchType: "image/png"}
	svc := NewImageStudioGalleryService(store, saver)

	entry, err := svc.SaveFromURL(
		context.Background(),
		42,
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		"https://upstream.example.com/out.png",
	)
	require.NoError(t, err)
	require.Equal(t, "https://upstream.example.com/out.png", saver.fetchedURL)
	require.Equal(t, entry.ID+".png", saver.key)
	require.Equal(t, "image/png", saver.contentType)
	require.Len(t, saver.data, len(smallPNG(t)))
}

// 删除作品：先把对象存储里的文件删掉，再删记录。
func TestImageStudioGalleryDeleteRemovesObjectThenRecord(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)

	entry, err := svc.Save(
		context.Background(),
		42,
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		"image/png",
		smallPNG(t),
	)
	require.NoError(t, err)

	require.NoError(t, svc.Delete(context.Background(), 42, entry.ID))
	require.Equal(t, []string{"images/" + entry.ID + ".png"}, saver.deletedObject, "删记录前必须先删对象")
	require.Equal(t, []string{entry.ID}, store.deleted)
}

// 删对象失败时保留记录：否则那个文件就成了永远找不到的孤儿。
func TestImageStudioGalleryDeleteKeepsRecordWhenObjectDeleteFails(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{deleteErr: ErrImageStorageIncomplete}
	svc := NewImageStudioGalleryService(store, saver)

	entry, err := svc.Save(
		context.Background(),
		42,
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		"image/png",
		smallPNG(t),
	)
	require.NoError(t, err)

	require.ErrorIs(t, svc.Delete(context.Background(), 42, entry.ID), ErrImageStorageIncomplete)
	require.Empty(t, store.deleted, "对象没删掉就不该删记录")
}

// 删除别人的作品（或者不存在的 id）要报 not found，而不是静默成功。
func TestImageStudioGalleryDeleteUnknownWork(t *testing.T) {
	store := &galleryStoreStub{objectKeys: map[string]string{}}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{})

	require.ErrorIs(t, svc.Delete(context.Background(), 42, "nope"), ErrStudioWorkNotFound)
}

func TestImageStudioGalleryRejectsWhenUserLimitReached(t *testing.T) {
	entries := make([]*ImageStudioGalleryEntry, StudioWorksQuotaPerUser)
	for i := range entries {
		entries[i] = &ImageStudioGalleryEntry{}
	}
	store := &galleryStoreStub{entries: entries}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)

	_, err := svc.Save(
		context.Background(),
		42,
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		"image/png",
		smallPNG(t),
	)
	require.ErrorIs(t, err, ErrImageStudioGalleryQuotaExceeded)
	require.Empty(t, saver.key)
}

func smallPNG(t *testing.T) []byte {
	t.Helper()
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
		0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99,
		0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
		0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
}
