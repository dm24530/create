//go:build unit

package service

import (
	"bytes"
	"context"
	"encoding/base64"
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

func (s *videoGalleryStoreStub) SweepExpired(context.Context, int) ([]string, error) {
	return nil, nil
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

func (s *videoMediaSaverStub) GalleryRetention() time.Duration { return 30 * 24 * time.Hour }

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
	entry, err := svc.Save(ctx, 1, "镜头", "seedance-2-720p", "mp4", 8, "image/png", mp4Bytes(), true)
	require.NoError(t, err)
	require.Equal(t, "video/mp4", saver.types[0])
	require.Equal(t, "videos/", videoStoragePrefix)
	require.True(t, bytes.HasSuffix([]byte(entry.URL), []byte(".mp4")))
	require.Equal(t, 8, entry.DurationSeconds)
	require.Equal(t, "镜头", entry.Prompt)
	require.Equal(t, int64(0), entry.ExpiresAt, "作品不再有过期时间")
	require.True(t, bytes.HasPrefix([]byte(entry.ObjectKey), []byte(videoStoragePrefix)),
		"object_key 必须带 videos/ 前缀，删除时才能定位对象")
	require.Len(t, store.saved, 1)
}

func TestVideoStudioGalleryUploadReferenceAssetSkipsGalleryRows(t *testing.T) {
	store := &videoGalleryStoreStub{}
	saver := &videoMediaSaverStub{}
	svc := NewVideoStudioGalleryService(store, saver)
	ctx := context.Background()

	imageURL, err := svc.UploadReferenceAsset(ctx, 42, "image", "image/png", pngBytes)
	require.NoError(t, err)
	require.Contains(t, imageURL, "/video-references/")
	require.Len(t, saver.imageKeys, 1)
	require.Equal(t, "image/png", saver.imageTypes[0])

	videoURL, err := svc.UploadReferenceAsset(ctx, 42, "video", "video/mp4", mp4Bytes())
	require.NoError(t, err)
	require.Contains(t, videoURL, "/video-references/")
	require.Len(t, saver.keys, 1)

	audioURL, err := svc.UploadReferenceAsset(ctx, 42, "audio", "audio/mpeg", []byte("fake-mp3"))
	require.NoError(t, err)
	require.Contains(t, audioURL, "/video-references/")
	require.Len(t, saver.audioKeys, 1)
	require.Equal(t, "audio/mpeg", saver.audioTypes[0])

	require.Empty(t, store.saved, "temporary reference assets must not create studio works")
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
