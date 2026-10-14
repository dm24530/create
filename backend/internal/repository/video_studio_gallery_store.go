package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/redis/go-redis/v9"
)

// 与图片图库同样的结构，只是换一个键前缀：同一份 Redis 里两类记录互不干扰。
const videoStudioGalleryKeyPrefix = "video_studio_gallery:"

type videoStudioGalleryStore struct {
	rdb *redis.Client
}

func NewVideoStudioGalleryStore(rdb *redis.Client) service.VideoStudioGalleryStore {
	return &videoStudioGalleryStore{rdb: rdb}
}

func (s *videoStudioGalleryStore) Save(ctx context.Context, entry *service.VideoStudioGalleryEntry, ttl time.Duration) error {
	if s == nil || s.rdb == nil || entry == nil {
		return service.ErrVideoStudioGalleryUnavailable
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	pipe := s.rdb.TxPipeline()
	pipe.ZRemRangeByScore(
		ctx,
		videoStudioGalleryIndexKey(entry.UserID),
		"-inf",
		fmt.Sprintf("%d", entry.CreatedAt-int64(ttl/time.Second)),
	)
	pipe.Set(ctx, videoStudioGalleryEntryKey(entry.UserID, entry.ID), data, ttl)
	pipe.ZAdd(ctx, videoStudioGalleryIndexKey(entry.UserID), redis.Z{
		Score:  float64(entry.CreatedAt),
		Member: entry.ID,
	})
	pipe.Expire(ctx, videoStudioGalleryIndexKey(entry.UserID), ttl)
	_, err = pipe.Exec(ctx)
	return err
}

func (s *videoStudioGalleryStore) List(ctx context.Context, userID int64, limit int) ([]*service.VideoStudioGalleryEntry, error) {
	if s == nil || s.rdb == nil || userID <= 0 || limit <= 0 {
		return []*service.VideoStudioGalleryEntry{}, nil
	}
	indexKey := videoStudioGalleryIndexKey(userID)
	ids, err := s.rdb.ZRevRange(ctx, indexKey, 0, int64(limit-1)).Result()
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []*service.VideoStudioGalleryEntry{}, nil
	}

	keys := make([]string, 0, len(ids))
	for _, id := range ids {
		keys = append(keys, videoStudioGalleryEntryKey(userID, id))
	}
	values, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Unix()
	out := make([]*service.VideoStudioGalleryEntry, 0, len(values))
	staleIDs := make([]any, 0)
	for i, value := range values {
		raw, ok := value.(string)
		if !ok {
			staleIDs = append(staleIDs, ids[i])
			continue
		}
		var entry service.VideoStudioGalleryEntry
		if err := json.Unmarshal([]byte(raw), &entry); err != nil {
			staleIDs = append(staleIDs, ids[i])
			continue
		}
		if entry.ExpiresAt <= now {
			staleIDs = append(staleIDs, ids[i])
			continue
		}
		out = append(out, &entry)
	}
	if len(staleIDs) > 0 {
		_ = s.rdb.ZRem(ctx, indexKey, staleIDs...).Err()
	}
	return out, nil
}

func (s *videoStudioGalleryStore) Count(ctx context.Context, userID int64) (int64, error) {
	if s == nil || s.rdb == nil || userID <= 0 {
		return 0, nil
	}
	return s.rdb.ZCard(ctx, videoStudioGalleryIndexKey(userID)).Result()
}

func (s *videoStudioGalleryStore) Delete(ctx context.Context, userID int64, id string) error {
	if s == nil || s.rdb == nil || userID <= 0 || id == "" {
		return service.ErrVideoStudioGalleryUnavailable
	}
	pipe := s.rdb.TxPipeline()
	pipe.ZRem(ctx, videoStudioGalleryIndexKey(userID), id)
	pipe.Del(ctx, videoStudioGalleryEntryKey(userID, id))
	_, err := pipe.Exec(ctx)
	return err
}

func videoStudioGalleryEntryKey(userID int64, id string) string {
	return fmt.Sprintf("%s%d:%s", videoStudioGalleryKeyPrefix, userID, id)
}

func videoStudioGalleryIndexKey(userID int64) string {
	return fmt.Sprintf("%s%d:index", videoStudioGalleryKeyPrefix, userID)
}
