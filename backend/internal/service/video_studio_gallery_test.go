//go:build unit

package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type videoGalleryStoreStub struct {
	saved      []*VideoStudioGalleryEntry
	objectKeys map[string]string
	deleted    []string
	saveErr    error
}

func (s *videoGalleryStoreStub) Save(_ context.Context, entry *VideoStudioGalleryEntry, _ int64) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	s.saved = append(s.saved, entry)
	if s.objectKeys == nil {
		s.objectKeys = map[string]string{}
	}
	s.objectKeys[entry.ID] = entry.ObjectKey
	return nil
}

func (s *videoGalleryStoreStub) List(context.Context, int64, int, *bool) ([]*VideoStudioGalleryEntry, error) {
	return s.saved, nil
}

func (s *videoGalleryStoreStub) Count(context.Context, int64) (int64, error) { return 0, nil }

func (s *videoGalleryStoreStub) ObjectKey(_ context.Context, _ int64, id string) (string, error) {
	key, ok := s.objectKeys[id]
	if !ok {
		return "", ErrStudioWorkNotFound
	}
	return key, nil
}

func (s *videoGalleryStoreStub) FindBySourceID(
	_ context.Context,
	userID int64,
	sourceID string,
) (*VideoStudioGalleryEntry, error) {
	for _, entry := range s.saved {
		if entry != nil && entry.UserID == userID && entry.SourceID == sourceID {
			return entry, nil
		}
	}
	return nil, ErrStudioWorkNotFound
}

func (s *videoGalleryStoreStub) Delete(_ context.Context, _ int64, id string) error {
	s.deleted = append(s.deleted, id)
	return nil
}

func (s *videoGalleryStoreStub) Pin(_ context.Context, _ int64, id string, _ int64) error {
	s.deleted = append(s.deleted, "pin:"+id)
	return nil
}

func (s *videoGalleryStoreStub) Unpin(_ context.Context, _ int64, id string, expiresAt int64) error {
	for _, entry := range s.saved {
		if entry.ID == id {
			entry.Saved = false
			entry.ExpiresAt = expiresAt
			return nil
		}
	}
	return ErrStudioWorkNotFound
}

func (s *videoGalleryStoreStub) ListExpired(context.Context, int) ([]ExpiredStudioWork, error) {
	return nil, nil
}

func (s *videoGalleryStoreStub) DeleteExpiredByIDs(context.Context, []string) (int, error) {
	return 0, nil
}

type videoMediaSaverStub struct {
	keys          []string
	types         []string
	imageKeys     []string
	imageTypes    []string
	audioKeys     []string
	audioTypes    []string
	deletedObject []string
	quota         int
	presignBytes  int64
	presignType   string
}

func TestVideoStudioGalleryUnpinReturnsTemporaryExpiry(t *testing.T) {
	createdAt := time.Now().UTC().Add(-time.Hour).Unix()
	before := time.Now().UTC().Unix()
	store := &videoGalleryStoreStub{saved: []*VideoStudioGalleryEntry{{
		ID:        "video-unpin",
		UserID:    42,
		Saved:     true,
		CreatedAt: createdAt,
	}}}
	svc := NewVideoStudioGalleryService(store, &videoMediaSaverStub{})

	entry, err := svc.Unpin(context.Background(), 42, "video-unpin")

	require.NoError(t, err)
	require.NotNil(t, entry)
	require.False(t, entry.Saved)
	require.GreaterOrEqual(t, entry.ExpiresAt, before+int64((30*24*time.Hour)/time.Second))
}

func TestVideoStudioGalleryUnpinSavedWorkAfterRetentionStartsFreshTemporaryWindow(t *testing.T) {
	createdAt := time.Now().UTC().Add(-60 * 24 * time.Hour).Unix()
	store := &videoGalleryStoreStub{saved: []*VideoStudioGalleryEntry{{
		ID:        "video-old-saved",
		UserID:    42,
		Saved:     true,
		CreatedAt: createdAt,
	}}}
	svc := NewVideoStudioGalleryService(store, &videoMediaSaverStub{})
	now := time.Now().UTC().Unix()

	entry, err := svc.Unpin(context.Background(), 42, "video-old-saved")

	require.NoError(t, err)
	require.NotNil(t, entry)
	require.False(t, entry.Saved)
	require.GreaterOrEqual(t, entry.ExpiresAt, now+int64((30*24*time.Hour)/time.Second))
}

func (s *videoMediaSaverStub) SaveVideo(_ context.Context, key, contentType string, _ []byte) (string, error) {
	s.keys = append(s.keys, key)
	s.types = append(s.types, contentType)
	return "https://cdn.example.com/" + key, nil
}

func (s *videoMediaSaverStub) SaveImageWithKey(
	_ context.Context,
	key string,
	contentType string,
	_ []byte,
) (string, string, error) {
	s.imageKeys = append(s.imageKeys, key)
	s.imageTypes = append(s.imageTypes, contentType)
	return "https://cdn.example.com/" + key, key, nil
}

func (s *videoMediaSaverStub) PresignImageUpload(
	_ context.Context,
	key string,
	contentType string,
) (ImageStorageUploadRequest, error) {
	s.imageKeys = append(s.imageKeys, key)
	s.imageTypes = append(s.imageTypes, contentType)
	return ImageStorageUploadRequest{
		URL:     "https://upload.example.com/" + strings.TrimLeft(key, "/"),
		Headers: map[string]string{"Content-Type": contentType},
	}, nil
}

func (s *videoMediaSaverStub) PresignImageObject(_ context.Context, key string) (string, error) {
	return "https://read.example.com/" + strings.TrimLeft(key, "/"), nil
}

func (s *videoMediaSaverStub) ImageObjectStat(_ context.Context, _ string) (ImageObjectMetadata, error) {
	return ImageObjectMetadata{Bytes: s.presignBytes, ContentType: s.presignType}, nil
}

func (s *videoMediaSaverStub) SaveVideoReferenceAudio(
	_ context.Context,
	key string,
	contentType string,
	_ []byte,
) (string, error) {
	s.audioKeys = append(s.audioKeys, key)
	s.audioTypes = append(s.audioTypes, contentType)
	return "https://cdn.example.com/" + key, nil
}

func (s *videoMediaSaverStub) FetchVideoURL(context.Context, string) ([]byte, string, error) {
	return mp4Bytes(), "video/mp4", nil
}

func (s *videoMediaSaverStub) OpenMediaURL(context.Context, string) (io.ReadCloser, string, error) {
	return io.NopCloser(strings.NewReader("video")), "video/mp4", nil
}

func (s *videoMediaSaverStub) PresignImageObjects(
	_ context.Context,
	keys []string,
) (map[string]string, error) {
	resolved := make(map[string]string, len(keys))
	for _, key := range keys {
		resolved[key] = "https://fresh.example.com/" + strings.TrimLeft(key, "/")
	}
	return resolved, nil
}

func (s *videoMediaSaverStub) VideoRetention() time.Duration { return 30 * 24 * time.Hour }

func (s *videoMediaSaverStub) DeleteObject(_ context.Context, key string) error {
	s.deletedObject = append(s.deletedObject, key)
	return nil
}

func (s *videoMediaSaverStub) StudioWorksQuota() int {
	return s.quota
}

// 真实的 mp4 文件头，让 http.DetectContentType 能识别出来。
func mp4Bytes() []byte {
	return append([]byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"), bytes.Repeat([]byte{0}, 32)...)
}

func base64Of(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func TestVideoStudioGalleryArchivesOnlyVideos(t *testing.T) {
	store := &videoGalleryStoreStub{}
	saver := &videoMediaSaverStub{}
	svc := NewVideoStudioGalleryService(store, saver)
	ctx := context.Background()

	// 图片内容既没有视频声明，嗅探也不是视频，必须拒绝。
	_, err := svc.Save(ctx, 1, "p", "m", "png", 5, "image/png", pngBytes, true)
	require.ErrorIs(t, err, ErrVideoStudioUnsupportedType)

	// 声明的类型不实（假装 png）时按内容嗅探，仍然识别为视频并归档。
	entry, err := svc.Save(
		ctx, 1, "镜头", "seedance-2-720p", "mp4", 8, "image/png", mp4Bytes(), true,
		VideoStudioGallerySaveOptions{SortOrder: 67890},
	)
	require.NoError(t, err)
	require.Equal(t, "video/mp4", saver.types[0])
	require.Equal(t, "videos/", videoStoragePrefix)
	require.True(t, bytes.HasSuffix([]byte(entry.URL), []byte(".mp4")))
	require.Equal(t, 8, entry.DurationSeconds)
	require.Equal(t, int64(67890), entry.SortOrder)
	require.Equal(t, "镜头", entry.Prompt)
	require.Equal(t, int64(0), entry.ExpiresAt, "作品不再有过期时间")
	require.True(t, bytes.HasPrefix([]byte(entry.ObjectKey), []byte(videoStoragePrefix)),
		"object_key 必须带 videos/ 前缀，删除时才能定位对象")
	require.Len(t, store.saved, 1)
}

func TestVideoStudioGalleryArchiveIsIdempotentBySourceID(t *testing.T) {
	store := &videoGalleryStoreStub{}
	saver := &videoMediaSaverStub{}
	svc := NewVideoStudioGalleryService(store, saver)
	options := VideoStudioGallerySaveOptions{SourceID: "seedance:task-123"}

	first, err := svc.Save(
		context.Background(), 42, "同一个镜头", "seedance-2.0-fast", "mp4", 8,
		"video/mp4", mp4Bytes(), false, options,
	)
	require.NoError(t, err)
	second, err := svc.Save(
		context.Background(), 42, "同一个镜头", "seedance-2.0-fast", "mp4", 8,
		"video/mp4", mp4Bytes(), false, options,
	)

	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)
	require.Equal(t, "seedance:task-123", second.SourceID)
	require.Len(t, store.saved, 1)
	require.Len(t, saver.keys, 1, "retry must return the existing row before uploading another object")
}

func TestVideoStudioGalleryUsesMicrosecondSortOrderWhenMissing(t *testing.T) {
	store := &videoGalleryStoreStub{}
	svc := NewVideoStudioGalleryService(store, &videoMediaSaverStub{})
	createdAt := time.Now().UTC().Add(-time.Minute).Unix()

	entry, err := svc.Save(
		context.Background(),
		42,
		"稳定位置",
		"seedance-2-720p",
		"mp4",
		5,
		"video/mp4",
		mp4Bytes(),
		false,
		VideoStudioGallerySaveOptions{CreatedAt: createdAt},
	)

	require.NoError(t, err)
	require.Equal(t, createdAt*1_000_000, entry.SortOrder)
}

func TestVideoStudioGalleryUploadReferenceAssetSkipsGalleryRows(t *testing.T) {
	store := &videoGalleryStoreStub{}
	saver := &videoMediaSaverStub{}
	svc := NewVideoStudioGalleryService(store, saver)
	ctx := context.Background()

	imageURL, err := svc.UploadReferenceAsset(ctx, 42, "image", "image/png", pngBytes)
	require.NoError(t, err)
	require.Contains(t, decodedVideoReferenceObjectKey(t, imageURL), "/video-references/")
	require.Len(t, saver.imageKeys, 1)
	require.Equal(t, "image/png", saver.imageTypes[0])

	videoURL, err := svc.UploadReferenceAsset(ctx, 42, "video", "video/mp4", mp4Bytes())
	require.NoError(t, err)
	require.Contains(t, decodedVideoReferenceObjectKey(t, videoURL), "/video-references/")
	require.Len(t, saver.keys, 1)

	audioURL, err := svc.UploadReferenceAsset(ctx, 42, "audio", "audio/mpeg", []byte("fake-mp3"))
	require.NoError(t, err)
	require.Contains(t, decodedVideoReferenceObjectKey(t, audioURL), "/video-references/")
	require.Len(t, saver.audioKeys, 1)
	require.Equal(t, "audio/mpeg", saver.audioTypes[0])

	require.Empty(t, store.saved, "temporary reference assets must not create studio works")
}

func decodedVideoReferenceObjectKey(t *testing.T, rawURL string) string {
	t.Helper()
	token := strings.TrimPrefix(rawURL, VideoReferencePublicPrefix)
	require.NotEqual(t, rawURL, token)
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	require.NoError(t, err)
	return string(decoded)
}

func TestVideoStudioGalleryDirectReferenceUploadPresignAndComplete(t *testing.T) {
	saver := &videoMediaSaverStub{}
	svc := NewVideoStudioGalleryService(&videoGalleryStoreStub{}, saver)
	ctx := context.Background()

	presign, err := svc.PresignReferenceAsset(ctx, 42, "image", "image/webp", 900_000)
	require.NoError(t, err)
	require.Contains(t, presign.ObjectKey, "/video-references/")
	require.Contains(t, presign.UploadURL, "https://upload.example.com/")
	require.Equal(t, "image/webp", presign.ContentType)

	saver.presignBytes = 900_000
	saver.presignType = "image/webp"
	url, err := svc.CompleteReferenceAsset(
		ctx,
		42,
		"image",
		"image/webp",
		presign.ObjectKey,
		900_000,
	)
	require.NoError(t, err)
	require.Contains(t, url, "https://read.example.com/")
	require.Empty(t, saver.deletedObject)
}

func TestVideoStudioGalleryDirectReferenceUploadRejectsWrongOwnerAndSize(t *testing.T) {
	saver := &videoMediaSaverStub{presignBytes: 10, presignType: "image/webp"}
	svc := NewVideoStudioGalleryService(&videoGalleryStoreStub{}, saver)
	ctx := context.Background()

	presign, err := svc.PresignReferenceAsset(ctx, 42, "image", "image/webp", 900_000)
	require.NoError(t, err)

	_, err = svc.CompleteReferenceAsset(ctx, 7, "image", "image/webp", presign.ObjectKey, 900_000)
	require.ErrorIs(t, err, ErrVideoStudioUnsupportedType)

	_, err = svc.CompleteReferenceAsset(ctx, 42, "image", "image/webp", presign.ObjectKey, 900_000)
	require.ErrorIs(t, err, ErrVideoStudioReferenceAssetTooLarge)
	require.Equal(t, []string{presign.ObjectKey}, saver.deletedObject)
}

func TestVideoStudioGalleryListHidesLegacyReferenceVideos(t *testing.T) {
	store := &videoGalleryStoreStub{saved: []*VideoStudioGalleryEntry{
		{
			ID:              "legacy-reference",
			Prompt:          "Video reference",
			DurationSeconds: 0,
			Saved:           false,
		},
		{
			ID:     "generated-video",
			Prompt: "雨后街景",
			Saved:  false,
		},
	}}
	svc := NewVideoStudioGalleryService(store, &videoMediaSaverStub{})

	entries, err := svc.List(context.Background(), 42, 10, nil)

	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, "generated-video", entries[0].ID)
}

func TestVideoStudioGalleryListRefreshesArchivedVideoURLs(t *testing.T) {
	store := &videoGalleryStoreStub{saved: []*VideoStudioGalleryEntry{{
		ID:        "video-1",
		ObjectKey: "videos/users/42/video-1.mp4",
		URL:       "https://expired.example.com/video-1.mp4?signature=old",
	}}}
	svc := NewVideoStudioGalleryService(store, &videoMediaSaverStub{})

	entries, err := svc.List(context.Background(), 42, 10, nil)

	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(
		t,
		"https://fresh.example.com/videos/users/42/video-1.mp4",
		entries[0].URL,
	)
}

func TestVideoStudioGalleryRejectsOversizedArchives(t *testing.T) {
	svc := NewVideoStudioGalleryService(&videoGalleryStoreStub{}, &videoMediaSaverStub{})
	tooBig := make([]byte, maxVideoArchiveBytes+1)
	copy(tooBig, mp4Bytes())

	_, err := svc.Save(context.Background(), 1, "p", "m", "mp4", 5, "video/mp4", tooBig, true)
	require.ErrorIs(t, err, ErrVideoStudioArchiveTooLarge)
}

// 删除视频作品要连带删掉对象存储里的文件。
func TestVideoStudioGalleryDeleteRemovesObjectThenRecord(t *testing.T) {
	store := &videoGalleryStoreStub{}
	saver := &videoMediaSaverStub{}
	svc := NewVideoStudioGalleryService(store, saver)

	entry, err := svc.Save(context.Background(), 1, "镜头", "m", "mp4", 5, "video/mp4", mp4Bytes(), true)
	require.NoError(t, err)
	require.NoError(t, svc.Delete(context.Background(), 1, entry.ID))

	require.Equal(t, []string{entry.ObjectKey}, saver.deletedObject)
	require.Equal(t, []string{entry.ID}, store.deleted)
}

func TestDecodeVideoDataURLRejectsNonVideo(t *testing.T) {
	_, _, err := DecodeVideoDataURL("data:image/png;base64," + base64Of(pngBytes))
	require.ErrorIs(t, err, ErrVideoStudioUnsupportedType)

	data, contentType, err := DecodeVideoDataURL("data:video/mp4;base64," + base64Of(mp4Bytes()))
	require.NoError(t, err)
	require.Equal(t, "video/mp4", contentType)
	require.NotEmpty(t, data)
}

func TestDecodeAudioDataURLRejectsNonAudio(t *testing.T) {
	_, _, err := DecodeAudioDataURL("data:image/png;base64," + base64Of(pngBytes))
	require.ErrorIs(t, err, ErrVideoStudioUnsupportedType)

	data, contentType, err := DecodeAudioDataURL("data:audio/mpeg;base64," + base64Of([]byte("fake-mp3")))
	require.NoError(t, err)
	require.Equal(t, "audio/mpeg", contentType)
	require.NotEmpty(t, data)
}

type referenceStorageBranchStub struct {
	savedKey string
	savedURL string
}

func (s *referenceStorageBranchStub) ReferenceKeyPrefix() string { return "video-references/" }
func (s *referenceStorageBranchStub) SaveReferenceObject(_ context.Context, key, _ string, _ []byte) (string, string, error) {
	s.savedKey = "video-references/" + key
	s.savedURL = "https://ref.superai.sbs/" + s.savedKey
	return s.savedURL, s.savedKey, nil
}
func (s *referenceStorageBranchStub) PresignReferenceUpload(context.Context, string, string) (ImageStorageUploadRequest, string, error) {
	return ImageStorageUploadRequest{URL: "https://upload.example.com"}, s.savedKey, nil
}
func (s *referenceStorageBranchStub) StatReferenceObject(context.Context, string) (ImageObjectMetadata, error) {
	return ImageObjectMetadata{Bytes: 1, ContentType: "image/webp"}, nil
}
func (s *referenceStorageBranchStub) PresignReferenceObject(context.Context, string) (string, error) {
	return s.savedURL, nil
}
func (s *referenceStorageBranchStub) DeleteReferenceObject(context.Context, string) error { return nil }

func TestVideoStudioReferenceAssetsUseDedicatedStorage(t *testing.T) {
	svc := NewVideoStudioGalleryService(&videoGalleryStoreStub{}, &videoMediaSaverStub{})
	refs := &referenceStorageBranchStub{}
	svc.referenceStorage = refs
	svc.identities = fixedUserStorageIdentityResolver{key: "user-storage"}

	url, err := svc.UploadReferenceAsset(context.Background(), 42, "image", "image/webp", pngBytes)
	require.NoError(t, err)
	require.Equal(t, refs.savedURL, url)
	require.Regexp(t, `^video-references/user-storage/[a-f0-9]+\.webp$`, refs.savedKey)
}
