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
}

func (s *videoGalleryStoreStub) Save(_ context.Context, entry *VideoStudioGalleryEntry) error {
	s.saved = append(s.saved, entry)
	if s.objectKeys == nil {
		s.objectKeys = map[string]string{}
	}
	s.objectKeys[entry.ID] = entry.ObjectKey
	return nil
}

func (s *videoGalleryStoreStub) List(context.Context, int64, int) ([]*VideoStudioGalleryEntry, error) {
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

type videoMediaSaverStub struct {
	keys          []string
	types         []string
	deletedObject []string
	quota         int
}

func (s *videoMediaSaverStub) SaveVideo(_ context.Context, key, contentType string, _ []byte) (string, error) {
	s.keys = append(s.keys, key)
	s.types = append(s.types, contentType)
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
	_, err := svc.Save(ctx, 1, "p", "m", "png", 5, "image/png", pngBytes)
	require.ErrorIs(t, err, ErrVideoStudioUnsupportedType)

	// 声明的类型不实（假装 png）时按内容嗅探，仍然识别为视频并归档。
	entry, err := svc.Save(ctx, 1, "镜头", "seedance-2-720p", "mp4", 8, "image/png", mp4Bytes())
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

func TestVideoStudioGalleryRejectsOversizedArchives(t *testing.T) {
	svc := NewVideoStudioGalleryService(&videoGalleryStoreStub{}, &videoMediaSaverStub{})
	tooBig := make([]byte, maxVideoArchiveBytes+1)
	copy(tooBig, mp4Bytes())

	_, err := svc.Save(context.Background(), 1, "p", "m", "mp4", 5, "video/mp4", tooBig)
	require.ErrorIs(t, err, ErrVideoStudioArchiveTooLarge)
}

// 删除视频作品要连带删掉对象存储里的文件。
func TestVideoStudioGalleryDeleteRemovesObjectThenRecord(t *testing.T) {
	store := &videoGalleryStoreStub{}
	saver := &videoMediaSaverStub{}
	svc := NewVideoStudioGalleryService(store, saver)

	entry, err := svc.Save(context.Background(), 1, "镜头", "m", "mp4", 5, "video/mp4", mp4Bytes())
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
