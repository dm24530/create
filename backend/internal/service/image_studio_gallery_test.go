//go:build unit

package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type galleryStoreStub struct {
	entries    []*ImageStudioGalleryEntry
	objectKeys map[string]string
	deleted    []string
	// saveErr 用来模拟存储层在事务里判定超额（并发场景）。
	saveErr error
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
	// quota 为 0 时走内置默认值，用来验证后台配置的配额能被读到。
	quota int
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

func (s *gallerySaverStub) StudioWorksQuota() int {
	return s.quota
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
	)
	require.ErrorIs(t, err, ErrImageStudioGalleryQuotaExceeded)
	require.Len(t, saver.deletedObject, 1, "被配额拒绝时要撤回刚上传的对象")
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
	svc := NewImageStudioGalleryService(store, &gallerySaverStub{quota: 2})

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

	quota, err := svc.Quota(context.Background(), 42)
	require.NoError(t, err)
	require.Equal(t, int64(2), quota.Limit, "上限要用后台配置的值")
	require.Equal(t, int64(2), quota.Used)
}

// 列表条数必须跟着配额走：否则配额放宽后，更早的作品既看不到也删不掉。
func TestStudioWorksListLimitFollowsConfiguredQuota(t *testing.T) {
	require.Equal(t, 100, studioWorksListLimit(nil), "没有配置时用默认值")
	require.Equal(t, 100, studioWorksListLimit(&gallerySaverStub{}), "配额为 0 时用默认值")
	require.Equal(t, 500, studioWorksListLimit(&gallerySaverStub{quota: 500}), "配额 500 就要能取到 500 条")
	require.Equal(t, studioWorksListLimitMax, studioWorksListLimit(&gallerySaverStub{quota: 10000}),
		"配额再大也不能一次吐一万条")
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
