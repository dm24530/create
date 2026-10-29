//go:build unit

package service

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type galleryStoreStub struct {
	entries    []*ImageStudioGalleryEntry
	objectKeys map[string]string
	deleted    []string
	swept      []string
	// saveErr 用来模拟存储层在事务里判定超额（并发场景）。
	saveErr error
	// pinErr 用来模拟"存进我的作品"时存储层判定超额。
	pinErr error
}

func (s *galleryStoreStub) Save(_ context.Context, entry *ImageStudioGalleryEntry, _ int64) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	s.entries = append(s.entries, entry)
	if s.objectKeys == nil {
		s.objectKeys = map[string]string{}
	}
	s.objectKeys[entry.ID] = entry.ObjectKey
	return nil
}

func (s *galleryStoreStub) List(_ context.Context, _ int64, limit int, _ *bool) ([]*ImageStudioGalleryEntry, error) {
	if limit <= 0 {
		return nil, nil
	}
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

func (s *galleryStoreStub) UpdateThumb(_ context.Context, _ int64, id, thumbURL, thumbObjectKey string) error {
	for _, entry := range s.entries {
		if entry.ID == id {
			entry.ThumbURL = thumbURL
			entry.ThumbObjectKey = thumbObjectKey
			return nil
		}
	}
	return ErrStudioWorkNotFound
}

func (s *galleryStoreStub) Delete(_ context.Context, _ int64, id string) error {
	s.deleted = append(s.deleted, id)
	return nil
}

func (s *galleryStoreStub) Pin(_ context.Context, _ int64, id string, _ int64) error {
	if s.pinErr != nil {
		return s.pinErr
	}
	s.deleted = append(s.deleted, "pin:"+id)
	return nil
}

func (s *galleryStoreStub) Unpin(_ context.Context, _ int64, id string, expiresAt int64) error {
	for _, entry := range s.entries {
		if entry.ID == id {
			entry.Saved = false
			entry.ExpiresAt = expiresAt
			return nil
		}
	}
	return ErrStudioWorkNotFound
}

func (s *galleryStoreStub) SweepExpired(context.Context, int) ([]string, error) {
	return s.swept, nil
}

type gallerySaverStub struct {
	key           string
	thumbKey      string
	contentType   string
	data          []byte
	retention     time.Duration
	fetchData     []byte
	fetchType     string
	fetchErr      error
	fetchedURL    string
	fetchCalls    int
	deleteErr     error
	deletedObject []string
	// quota 为 0 时走内置默认值，用来验证后台配置的配额能被读到。
	quota        int
	resolvedURLs map[string]string
	presignCalls int
	batchCalls   int
	downloadURL  string
	downloadHits int
	existsHits   int
	missing      map[string]bool
}

func (s *gallerySaverStub) SaveImageWithKey(
	_ context.Context, key, contentType string, data []byte,
) (string, string, error) {
	if strings.Contains(key, "/thumbs/") || strings.HasPrefix(key, "thumbs/") {
		s.thumbKey = key
		return "https://cdn.example.com/" + key, "images/" + key, nil
	}
	s.key = key
	s.contentType = contentType
	s.data = append([]byte(nil), data...)
	// 真实实现会加上配置的 Key 前缀，这里用一个固定前缀模拟，确保记录里存的是最终键。
	return "https://cdn.example.com/" + key, "images/" + key, nil
}

func (s *gallerySaverStub) FetchImageURL(_ context.Context, rawURL string) ([]byte, string, error) {
	s.fetchedURL = rawURL
	s.fetchCalls++
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

func (s *gallerySaverStub) StudioWorksQuota() int {
	return s.quota
}

func (s *gallerySaverStub) PresignImageObject(_ context.Context, objectKey string) (string, error) {
	s.presignCalls++
	if resolved := s.resolvedURLs[objectKey]; resolved != "" {
		return resolved, nil
	}
	return "https://cdn.example.com/" + strings.TrimLeft(objectKey, "/"), nil
}

func (s *gallerySaverStub) PresignImageObjectDownload(
	_ context.Context,
	objectKey string,
	_ string,
) (string, error) {
	s.downloadHits++
	if s.downloadURL != "" {
		return s.downloadURL, nil
	}
	return "https://cdn.example.com/download/" + strings.TrimLeft(objectKey, "/"), nil
}

func (s *gallerySaverStub) ImageObjectExists(_ context.Context, objectKey string) (bool, error) {
	s.existsHits++
	return !s.missing[objectKey], nil
}

func (s *gallerySaverStub) PresignImageObjects(
	_ context.Context,
	objectKeys []string,
) (map[string]string, error) {
	s.batchCalls++
	resolved := make(map[string]string, len(objectKeys))
	for _, objectKey := range objectKeys {
		if value := s.resolvedURLs[objectKey]; value != "" {
			resolved[objectKey] = value
		} else {
			resolved[objectKey] = "https://cdn.example.com/" + strings.TrimLeft(objectKey, "/")
		}
	}
	return resolved, nil
}

func TestImageStudioGalleryListRefreshesSignedOriginalAndThumbnailURLs(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:             "work-1",
		ObjectKey:      "images/work-1.png",
		URL:            "https://old-r2.example.com/work-1.png?X-Amz-Signature=old",
		ThumbURL:       "https://old-r2.example.com/thumbs/work-1.jpg?X-Amz-Signature=old",
		ThumbObjectKey: "images/thumbs/work-1.jpg",
	}}}
	saver := &gallerySaverStub{resolvedURLs: map[string]string{
		"images/work-1.png":        "https://gen.example.com/images/work-1.png",
		"images/thumbs/work-1.jpg": "https://gen.example.com/images/thumbs/work-1.jpg",
	}}
	svc := NewImageStudioGalleryService(store, saver)

	entries, err := svc.List(context.Background(), 7, 20, nil)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, "https://gen.example.com/images/work-1.png", entries[0].URL)
	require.Equal(t, "https://gen.example.com/images/thumbs/work-1.jpg", entries[0].ThumbURL)
	require.Equal(t, 1, saver.batchCalls)
	require.Zero(t, saver.presignCalls)
}

func TestImageStudioGalleryListHidesLegacyVideoReferenceImages(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{
		{
			ID:     "legacy-reference",
			Prompt: "Video reference image",
			Size:   "reference",
			Saved:  false,
		},
		{
			ID:     "generated-image",
			Prompt: "雨后的咖啡馆",
			Size:   "1024x1024",
			Saved:  false,
		},
	}}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{})

	entries, err := svc.List(context.Background(), 7, 20, nil)

	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, "generated-image", entries[0].ID)
}

func TestImageStudioGalleryListKeepsPendingLocalAssetURL(t *testing.T) {
	local := NewLocalImageAssetStore(t.TempDir())
	meta, err := local.Save(
		context.Background(),
		7,
		"task-1",
		"images/users/7/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		smallPNG(t),
	)
	require.NoError(t, err)
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:        "work-1",
		ObjectKey: meta.ObjectKey,
		URL:       local.URL(meta.ID),
	}}}
	saver := &gallerySaverStub{resolvedURLs: map[string]string{
		meta.ObjectKey: "https://gen.example.com/images/users/7/task-1-0.png",
	}}
	svc := NewImageStudioGalleryService(store, saver)
	svc.SetLocalAssetStore(local)

	entries, err := svc.List(context.Background(), 7, 20, nil)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, local.URL(meta.ID), entries[0].URL)
	require.Zero(t, saver.batchCalls, "pending local assets must not be replaced by not-yet-uploaded R2 URLs")

	require.NoError(t, local.MarkUploaded(meta.ID, "https://cdn.example.com/image.png"))
	entries, err = svc.List(context.Background(), 7, 20, nil)
	require.NoError(t, err)
	require.Equal(t, "https://gen.example.com/images/users/7/task-1-0.png", entries[0].URL)
	require.Equal(t, 1, saver.batchCalls)
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
		true,
	)
	require.NoError(t, err)
	require.Equal(t, int64(42), entry.UserID)
	require.Equal(t, "users/42/"+entry.ID+".png", saver.key)
	require.Equal(t, "image/png", saver.contentType)
	require.Len(t, saver.data, len(smallPNG(t)))
	require.Equal(t, int64(0), entry.ExpiresAt, "作品不再有过期时间")
	require.Equal(t, "images/users/42/"+entry.ID+".png", entry.ObjectKey, "记录里必须存最终对象键（带前缀）")
	require.Equal(t, "https://cdn.example.com/users/42/thumbs/"+entry.ID+".jpg", entry.ThumbURL)
	require.Equal(t, "images/users/42/thumbs/"+entry.ID+".jpg", entry.ThumbObjectKey)
	require.Len(t, store.entries, 1)
}

func TestImageStudioGallerySaveUsesOpaqueUserStorageKey(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)
	svc.SetUserStorageIdentityResolver(fixedUserStorageIdentityResolver{
		key: "0123456789abcdef0123456789abcdef",
	})

	entry, err := svc.Save(
		context.Background(), 42, "cat", "model", "1024x1024", "png",
		"image/png", pngBytes, true,
	)
	require.NoError(t, err)
	require.Equal(t, "0123456789abcdef0123456789abcdef/"+entry.ID+".png", saver.key)
	require.Equal(t,
		"images/0123456789abcdef0123456789abcdef/"+entry.ID+".png",
		entry.ObjectKey,
	)
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
		true,
	)
	require.NoError(t, err)
	require.Equal(t, "https://upstream.example.com/out.png", saver.fetchedURL)
	require.Equal(t, "users/42/"+entry.ID+".png", saver.key)
	require.Equal(t, "image/png", saver.contentType)
	require.Len(t, saver.data, len(smallPNG(t)))
}

func TestImageStudioGallerySaveExistingObjectDoesNotReupload(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)

	entry, err := svc.SaveExistingObject(
		context.Background(),
		42,
		"images/users/42/task-1.png",
		"https://gen.example.com/images/users/42/task-1.png",
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"jpeg",
		false,
	)
	require.NoError(t, err)
	require.Empty(t, saver.key)
	require.Empty(t, saver.data)
	require.Equal(t, "images/users/42/task-1.png", entry.ObjectKey)
	require.Equal(t, "png", entry.Format)
	require.False(t, entry.Saved)
	require.NotZero(t, entry.ExpiresAt)
	require.Len(t, store.entries, 1)
}

func TestImageStudioGallerySaveExistingObjectPrefersActualContentType(t *testing.T) {
	store := &galleryStoreStub{}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{})

	entry, err := svc.SaveExistingObject(
		context.Background(),
		42,
		"images/users/42/task-1.jpg",
		"https://gen.example.com/images/users/42/task-1.jpg",
		"a cat",
		"gemini-image",
		"1024x1024",
		"jpeg",
		true,
		ImageStudioGallerySaveOptions{ContentType: "image/png"},
	)

	require.NoError(t, err)
	require.Equal(t, "png", entry.Format)
}

func TestImageStudioGallerySaveExistingObjectSynchronizesLocalAssetExpiry(t *testing.T) {
	local := NewLocalImageAssetStore(t.TempDir())
	meta, err := local.Save(
		context.Background(),
		42,
		"task-1",
		"images/users/42/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		smallPNG(t),
	)
	require.NoError(t, err)

	store := &galleryStoreStub{}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{retention: 7 * 24 * time.Hour})
	svc.SetLocalAssetStore(local)

	temporary, err := svc.SaveExistingObject(
		context.Background(),
		42,
		meta.ObjectKey,
		local.URL(meta.ID),
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		false,
	)
	require.NoError(t, err)
	temporaryMeta, err := local.Get(meta.ID)
	require.NoError(t, err)
	require.Equal(t, temporary.ExpiresAt, temporaryMeta.ExpiresAt)

	saved, err := svc.SaveExistingObject(
		context.Background(),
		42,
		meta.ObjectKey,
		local.URL(meta.ID),
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		true,
	)
	require.NoError(t, err)
	savedMeta, err := local.Get(meta.ID)
	require.NoError(t, err)
	require.Zero(t, saved.ExpiresAt)
	require.Zero(t, savedMeta.ExpiresAt)
}

func TestImageStudioGalleryPinAndUnpinUpdateLocalAssetExpiryAfterUpload(t *testing.T) {
	local := NewLocalImageAssetStore(t.TempDir())
	meta, err := local.Save(
		context.Background(),
		42,
		"task-1",
		"images/users/42/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		smallPNG(t),
	)
	require.NoError(t, err)
	require.NoError(t, local.MarkUploaded(meta.ID, "https://cdn.example.com/task-1.png"))

	createdAt := time.Now().UTC().Unix()
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:        "work-1",
		UserID:    42,
		ObjectKey: meta.ObjectKey,
		URL:       local.URL(meta.ID),
		CreatedAt: createdAt,
		Saved:     false,
	}}}
	saver := &gallerySaverStub{retention: 7 * 24 * time.Hour, resolvedURLs: map[string]string{
		meta.ObjectKey: "https://cdn.example.com/task-1.png",
	}}
	svc := NewImageStudioGalleryService(store, saver)
	svc.SetLocalAssetStore(local)

	require.NoError(t, svc.Pin(context.Background(), 42, "work-1"))
	pinned, err := local.Get(meta.ID)
	require.NoError(t, err)
	require.Zero(t, pinned.ExpiresAt)

	store.entries[0].Saved = true
	entry, err := svc.Unpin(context.Background(), 42, "work-1")
	require.NoError(t, err)
	unpinned, err := local.Get(meta.ID)
	require.NoError(t, err)
	require.Equal(t, entry.ExpiresAt, unpinned.ExpiresAt)
	require.NotZero(t, unpinned.ExpiresAt)
}

func TestImageStudioGalleryReadImageFetchesOwnedEntry(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{
		{ID: "work-1", URL: "https://cdn.example.com/work-1.png"},
	}}
	saver := &gallerySaverStub{
		fetchData: []byte("png-bytes"),
		fetchType: "image/png",
	}
	svc := NewImageStudioGalleryService(store, saver)

	entry, data, contentType, err := svc.ReadImage(context.Background(), 7, "work-1")
	require.NoError(t, err)
	require.Equal(t, "work-1", entry.ID)
	require.Equal(t, []byte("png-bytes"), data)
	require.Equal(t, "image/png", contentType)
	require.Equal(t, "https://cdn.example.com/work-1.png", saver.fetchedURL)
}

func TestImageStudioGalleryThumbnailResizesAndCaches(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{
		{ID: "work-1", URL: "https://cdn.example.com/work-1.png"},
	}}
	saver := &gallerySaverStub{
		fetchData: smallPNG(t),
		fetchType: "image/png",
	}
	svc := NewImageStudioGalleryService(store, saver)

	thumb, err := svc.Thumbnail(context.Background(), 7, "work-1", 120)
	require.NoError(t, err)
	require.True(t, len(thumb) > 2)
	require.Equal(t, []byte{0xFF, 0xD8}, thumb[:2], "thumbnail should be JPEG")

	_, err = svc.Thumbnail(context.Background(), 7, "work-1", 120)
	require.NoError(t, err)
	require.Equal(t, 1, saver.fetchCalls)
}

func TestImageStudioGalleryThumbnailPrefersExistingThumbnailObject(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{
		{
			ID:       "work-1",
			URL:      "https://cdn.example.com/work-1-original.png",
			ThumbURL: "https://cdn.example.com/work-1-thumb.jpg",
		},
	}}
	saver := &gallerySaverStub{
		fetchData: []byte{0xFF, 0xD8, 0xFF, 0x00},
		fetchType: "image/jpeg",
	}
	svc := NewImageStudioGalleryService(store, saver)

	thumb, err := svc.Thumbnail(context.Background(), 7, "work-1", 120)
	require.NoError(t, err)
	require.Equal(t, saver.fetchData, thumb)
	require.Equal(t, "https://cdn.example.com/work-1-thumb.jpg", saver.fetchedURL)
	require.Equal(t, 1, saver.fetchCalls)
}

func TestImageStudioGalleryThumbnailUsesStoredThumbURLInsteadOfDerivedObjectKey(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{
		{
			ID:        "work-1",
			ObjectKey: "images/users/42/task-1.png",
			URL:       "https://cdn.example.com/work-1-original.png",
			ThumbURL:  "https://cdn.example.com/images/thumbs/work-1.jpg",
		},
	}}
	saver := &gallerySaverStub{
		fetchData: []byte{0xFF, 0xD8, 0xFF, 0x00},
		fetchType: "image/jpeg",
		resolvedURLs: map[string]string{
			"images/users/42/thumbs/task-1.jpg": "https://cdn.example.com/wrong-derived-thumb.jpg",
		},
	}
	svc := NewImageStudioGalleryService(store, saver)

	thumb, err := svc.Thumbnail(context.Background(), 7, "work-1", 120)
	require.NoError(t, err)
	require.Equal(t, saver.fetchData, thumb)
	require.Equal(t, "https://cdn.example.com/images/thumbs/work-1.jpg", saver.fetchedURL)
	require.Zero(t, saver.presignCalls)
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
		true,
	)
	require.NoError(t, err)

	require.NoError(t, svc.Delete(context.Background(), 42, entry.ID))
	require.Equal(t, []string{
		"images/users/42/thumbs/" + entry.ID + ".jpg",
		"images/users/42/" + entry.ID + ".png",
	}, saver.deletedObject, "删记录前必须先删缩略图和原图")
	require.Equal(t, []string{entry.ID}, store.deleted)
}

// 存储"能用但这次调用失败"（网络/鉴权）时保留记录，用户重试即可；
// 这跟"存储根本没配好"是两种处置，后者见下面那个用例。
func TestImageStudioGalleryDeleteKeepsRecordWhenObjectDeleteFails(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{deleteErr: errors.New("S3 DeleteObject: connection reset by peer")}
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
		true,
	)
	require.NoError(t, err)

	require.Error(t, svc.Delete(context.Background(), 42, entry.ID))
	require.Empty(t, store.deleted, "对象没删掉就不该删记录")
}

// 删除别人的作品（或者不存在的 id）要报 not found，而不是静默成功。
func TestImageStudioGalleryDeleteUnknownWork(t *testing.T) {
	store := &galleryStoreStub{objectKeys: map[string]string{}}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{})

	require.ErrorIs(t, svc.Delete(context.Background(), 42, "nope"), ErrStudioWorkNotFound)
}

// 存储没配好（停用/凭证不全）时不能把用户卡死：记录照删，只是删不掉桶里的文件。
func TestImageStudioGalleryDeleteSucceedsWhenStorageIsNotConfigured(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{deleteErr: ErrImageStorageDisabled}
	svc := NewImageStudioGalleryService(store, saver)

	entry, err := svc.Save(
		context.Background(), 42, "a cat", "m", "1x1", "png", "image/png", smallPNG(t),
		true,
	)
	require.NoError(t, err)

	require.NoError(t, svc.Delete(context.Background(), 42, entry.ID))
	require.Equal(t, []string{entry.ID}, store.deleted, "存储没配好也要能删掉记录")
}

// 并发下由存储层抢先判定超额：要翻译成图片自己的配额错误，并把刚上传的对象撤掉，
// 否则那个对象就成了没人认领的孤儿。
func TestImageStudioGalleryRollsBackUploadWhenStoreRejectsQuota(t *testing.T) {
	store := &galleryStoreStub{saveErr: ErrStudioWorksQuotaExceeded}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)

	_, err := svc.Save(
		context.Background(), 42, "a cat", "m", "1x1", "png", "image/png", smallPNG(t),
		true,
	)
	require.ErrorIs(t, err, ErrImageStudioGalleryQuotaExceeded)
	require.Len(t, saver.deletedObject, 2, "被配额拒绝时要撤回原图和缩略图")
	require.Empty(t, store.entries)
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
		true,
	)
	require.ErrorIs(t, err, ErrImageStudioGalleryQuotaExceeded)
	require.Empty(t, saver.key)
}

// 配额上限来自后台配置，不是写死的 100。
func TestImageStudioGalleryHonoursConfiguredQuota(t *testing.T) {
	entries := make([]*ImageStudioGalleryEntry, 2)
	for i := range entries {
		entries[i] = &ImageStudioGalleryEntry{}
	}
	store := &galleryStoreStub{entries: entries}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{quota: 2, retention: 72 * time.Hour})

	_, err := svc.Save(
		context.Background(),
		42,
		"a cat",
		"gpt-image-1",
		"1024x1024",
		"png",
		"image/png",
		smallPNG(t),
		true,
	)
	require.ErrorIs(t, err, ErrImageStudioGalleryQuotaExceeded)

	quota, err := svc.Quota(context.Background(), 42)
	require.NoError(t, err)
	require.Equal(t, int64(2), quota.Limit, "上限要用后台配置的值")
	require.Equal(t, int64(2), quota.Used)
	require.Equal(t, int64((72 * time.Hour).Seconds()), quota.RetentionSeconds, "失败历史要用对象存储的临时保留期")
}

// 列表条数必须跟着配额走：否则配额放宽后，更早的作品既看不到也删不掉。
func TestStudioWorksListLimitFollowsConfiguredQuota(t *testing.T) {
	require.Equal(t, 100, studioWorksListLimit(nil), "没有配置时用默认值")
	require.Equal(t, 100, studioWorksListLimit(&gallerySaverStub{}), "配额为 0 时用默认值")
	require.Equal(t, 500, studioWorksListLimit(&gallerySaverStub{quota: 500}), "配额 500 就要能取到 500 条")
	require.Equal(t, studioWorksListLimitMax, studioWorksListLimit(&gallerySaverStub{quota: 10000}),
		"配额再大也不能一次吐一万条")
}

// 没勾"存到我的作品"的内容是临时档：带过期时间，且不占用 100 的配额。
func TestImageStudioGalleryTemporaryContentGetsExpiryAndSkipsQuota(t *testing.T) {
	entries := make([]*ImageStudioGalleryEntry, StudioWorksQuotaPerUser)
	for i := range entries {
		entries[i] = &ImageStudioGalleryEntry{Saved: true}
	}
	store := &galleryStoreStub{entries: entries}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{retention: 7 * 24 * time.Hour})

	_, savedErr := svc.Save(context.Background(), 42, "p", "m", "1x1", "png", "image/png", smallPNG(t), true)
	require.ErrorIs(t, savedErr, ErrImageStudioGalleryQuotaExceeded, "已保存的条目受配额限制")

	entry, err := svc.Save(context.Background(), 42, "p", "m", "1x1", "png", "image/png", smallPNG(t), false)
	require.NoError(t, err, "临时内容不该被 100 的配额拦住")
	require.False(t, entry.Saved)
	require.Equal(t, int64((7*24*time.Hour)/time.Second), entry.ExpiresAt-entry.CreatedAt)
}

func TestImageStudioGallerySaveUsesPerImageCompletionTimeAndDuration(t *testing.T) {
	store := &galleryStoreStub{}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{retention: 24 * time.Hour})
	completedAt := time.Now().UTC().Add(-time.Minute).Unix()
	beforeSave := time.Now().UTC().Unix()

	entry, err := svc.Save(
		context.Background(),
		42,
		"p",
		"m",
		"1x1",
		"png",
		"image/png",
		smallPNG(t),
		false,
		ImageStudioGallerySaveOptions{CreatedAt: completedAt, DurationMs: 3200, SortOrder: 12345},
	)

	require.NoError(t, err)
	require.Equal(t, completedAt, entry.CreatedAt)
	require.Equal(t, 3200, entry.DurationMs)
	require.Equal(t, int64(12345), entry.SortOrder)
	require.InDelta(
		t,
		beforeSave+int64((24*time.Hour)/time.Second),
		entry.ExpiresAt,
		2,
	)
}

func TestImageStudioGalleryRejectsClientTimeForExpiry(t *testing.T) {
	store := &galleryStoreStub{}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{retention: 24 * time.Hour})
	future := time.Now().UTC().Add(365 * 24 * time.Hour).Unix()

	entry, err := svc.Save(
		context.Background(),
		42,
		"p",
		"m",
		"1x1",
		"png",
		"image/png",
		smallPNG(t),
		false,
		ImageStudioGallerySaveOptions{CreatedAt: future},
	)

	require.NoError(t, err)
	require.LessOrEqual(t, entry.CreatedAt, time.Now().UTC().Unix())
	require.LessOrEqual(t, entry.ExpiresAt-time.Now().UTC().Unix(), int64((24*time.Hour)/time.Second))
}

// 把临时内容存进我的作品时，配额满要翻译成图库自己的错误码。
func TestImageStudioGalleryPinMapsQuotaError(t *testing.T) {
	store := &galleryStoreStub{pinErr: ErrStudioWorksQuotaExceeded}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{})

	require.ErrorIs(t, svc.Pin(context.Background(), 42, "abc"), ErrImageStudioGalleryQuotaExceeded)
}

func TestImageStudioGalleryUnpinReturnsTemporaryExpiry(t *testing.T) {
	createdAt := time.Now().UTC().Add(-time.Hour).Unix()
	before := time.Now().UTC().Unix()
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:        "img-unpin",
		UserID:    42,
		Saved:     true,
		CreatedAt: createdAt,
	}}}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{retention: 7 * 24 * time.Hour})

	entry, err := svc.Unpin(context.Background(), 42, "img-unpin")

	require.NoError(t, err)
	require.NotNil(t, entry)
	require.False(t, entry.Saved)
	require.GreaterOrEqual(t, entry.ExpiresAt, before+int64((7*24*time.Hour)/time.Second))
	require.False(t, store.entries[0].Saved)
}

func TestImageStudioGalleryUnpinSavedWorkAfterRetentionStartsFreshTemporaryWindow(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:        "img-expired",
		UserID:    42,
		Saved:     true,
		CreatedAt: time.Now().UTC().Add(-8 * 24 * time.Hour).Unix(),
	}}}
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{retention: 7 * 24 * time.Hour})
	before := time.Now().UTC().Unix()

	entry, err := svc.Unpin(context.Background(), 42, "img-expired")

	require.NoError(t, err)
	require.NotNil(t, entry)
	require.False(t, entry.Saved)
	require.GreaterOrEqual(t, entry.ExpiresAt, before+int64((7*24*time.Hour)/time.Second))
	require.Len(t, store.deleted, 0, "unpin must not delete the stored object")
}

// 清扫到期内容时，记录删掉之后桶里的对象也要删。
func TestImageStudioGallerySweepDeletesObjects(t *testing.T) {
	store := &galleryStoreStub{swept: []string{"images/a.png", "videos/b.mp4"}}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)

	n, err := svc.SweepExpired(context.Background(), 10)
	require.NoError(t, err)
	require.Equal(t, 2, n)
	require.Equal(t, []string{"images/a.png", "videos/b.mp4"}, saver.deletedObject)
}

func TestImageStudioGalleryDownloadURLFallsBackForPendingLocalAsset(t *testing.T) {
	local := NewLocalImageAssetStore(t.TempDir())
	meta, err := local.Save(
		context.Background(),
		42,
		"task-1",
		"images/abcdefabcdefabcdefabcdefabcdefab/task-1-0.png",
		"image/png",
		time.Now().Add(time.Hour).Unix(),
		smallPNG(t),
	)
	require.NoError(t, err)

	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:        "work-1",
		UserID:    42,
		ObjectKey: meta.ObjectKey,
		URL:       local.URL(meta.ID),
	}}}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)
	svc.SetLocalAssetStore(local)

	_, _, err = svc.DownloadURL(context.Background(), 42, "work-1", "image.png")
	require.ErrorIs(t, err, ErrImageStudioGalleryUnavailable)
	require.Zero(t, saver.downloadHits)
}

func TestImageStudioGalleryDownloadURLDoesNotBlockOnHeadObject(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:        "work-1",
		UserID:    42,
		ObjectKey: "images/abcdefabcdefabcdefabcdefabcdefab/missing.png",
		URL:       "https://cdn.example.com/missing.png",
	}}}
	saver := &gallerySaverStub{missing: map[string]bool{
		"images/abcdefabcdefabcdefabcdefabcdefab/missing.png": true,
	}}
	svc := NewImageStudioGalleryService(store, saver)

	_, url, err := svc.DownloadURL(context.Background(), 42, "work-1", "image.png")
	require.NoError(t, err)
	require.Contains(t, url, "/download/images/")
	require.Equal(t, 1, saver.downloadHits)
	require.Zero(t, saver.existsHits)
}

func TestImageStudioGalleryReadImageResolvesObjectKeyInsteadOfStaleURL(t *testing.T) {
	store := &galleryStoreStub{entries: []*ImageStudioGalleryEntry{{
		ID:        "work-1",
		UserID:    42,
		ObjectKey: "images/abcdefabcdefabcdefabcdefabcdefab/current.png",
		URL:       "https://old.example.com/expired.png?signature=old",
	}}}
	saver := &gallerySaverStub{
		fetchData: smallPNG(t),
		fetchType: "image/png",
		resolvedURLs: map[string]string{
			"images/abcdefabcdefabcdefabcdefabcdefab/current.png": "https://cdn.example.com/current.png",
		},
	}
	svc := NewImageStudioGalleryService(store, saver)

	_, data, contentType, err := svc.ReadImage(context.Background(), 42, "work-1")
	require.NoError(t, err)
	require.NotEmpty(t, data)
	require.Equal(t, "image/png", contentType)
	require.Equal(t, "https://cdn.example.com/current.png", saver.fetchedURL)
}

func smallPNG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
}

func TestImageStudioGallerySaveTranscodesRequestedFormat(t *testing.T) {
	store := &galleryStoreStub{}
	saver := &gallerySaverStub{}
	svc := NewImageStudioGalleryService(store, saver)

	entry, err := svc.Save(
		context.Background(),
		42,
		"a dog",
		"gemini-image",
		"4096x4096",
		"jpeg",
		"image/png",
		smallPNG(t),
		true,
	)
	require.NoError(t, err)
	require.Equal(t, "image/jpeg", saver.contentType)
	require.Equal(t, "jpeg", entry.Format)
	require.Contains(t, saver.key, ".jpg")
	_, format, err := image.Decode(bytes.NewReader(saver.data))
	require.NoError(t, err)
	require.Equal(t, "jpeg", format)
}
