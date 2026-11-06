package repository

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/redis/go-redis/v9"
)

const imageTaskKeyPrefix = "image_task:"
const imageTaskLeaseKeyPrefix = "image_task_lease:"
const imageTaskIdempotencyKeyPrefix = "image_task_idempotency:"
const imageTaskPendingKey = "image_task_pending"
const imageTaskPendingIndexReadyKey = "image_task_pending_index_ready"

type imageTaskStore struct {
	rdb *redis.Client
}

func NewImageTaskStore(rdb *redis.Client) service.ImageTaskStore {
	return &imageTaskStore{rdb: rdb}
}

func (s *imageTaskStore) Save(ctx context.Context, task *service.ImageTaskRecord, ttl time.Duration) error {
	data, err := json.Marshal(task)
	if err != nil {
		return err
	}
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, imageTaskKey(task.ID), data, ttl)
	if imageTaskCompleted(task) {
		pipe.ZRem(ctx, imageTaskPendingKey, task.ID)
	} else {
		pipe.ZAdd(ctx, imageTaskPendingKey, redis.Z{
			Score:  float64(task.CreatedAt),
			Member: task.ID,
		})
	}
	_, err = pipe.Exec(ctx)
	return err
}

func (s *imageTaskStore) Get(ctx context.Context, id string) (*service.ImageTaskRecord, error) {
	data, err := s.rdb.Get(ctx, imageTaskKey(id)).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, service.ErrImageTaskNotFound
		}
		return nil, err
	}
	var task service.ImageTaskRecord
	if err := json.Unmarshal(data, &task); err != nil {
		return nil, err
	}
	return &task, nil
}

func (s *imageTaskStore) ListPending(ctx context.Context, limit int) ([]*service.ImageTaskRecord, error) {
	if limit <= 0 {
		limit = 100
	}
	if err := s.ensurePendingIndex(ctx); err != nil {
		return nil, err
	}
	tasks := make([]*service.ImageTaskRecord, 0, limit)
	const pageSize int64 = 200
	var offset int64
	for len(tasks) < limit {
		ids, err := s.rdb.ZRange(ctx, imageTaskPendingKey, offset, offset+pageSize-1).Result()
		if err != nil {
			return nil, err
		}
		if len(ids) == 0 {
			break
		}
		offset += int64(len(ids))
		for _, id := range ids {
			data, err := s.rdb.Get(ctx, imageTaskKey(id)).Bytes()
			if err != nil {
				if err == redis.Nil {
					_ = s.rdb.ZRem(ctx, imageTaskPendingKey, id).Err()
					continue
				}
				return nil, err
			}
			var task service.ImageTaskRecord
			if err := json.Unmarshal(data, &task); err != nil {
				_ = s.rdb.ZRem(ctx, imageTaskPendingKey, id).Err()
				continue
			}
			if imageTaskCompleted(&task) {
				_ = s.rdb.ZRem(ctx, imageTaskPendingKey, id).Err()
				continue
			}
			tasks = append(tasks, &task)
			if len(tasks) >= limit {
				break
			}
		}
		if len(ids) < int(pageSize) {
			break
		}
	}
	return tasks, nil
}

func (s *imageTaskStore) ensurePendingIndex(ctx context.Context) error {
	exists, err := s.rdb.Exists(ctx, imageTaskPendingIndexReadyKey).Result()
	if err != nil || exists > 0 {
		return err
	}
	var cursor uint64
	pendingTasks := make([]redis.Z, 0)
	for {
		keys, next, scanErr := s.rdb.Scan(ctx, cursor, imageTaskKeyPrefix+"*", 200).Result()
		if scanErr != nil {
			return scanErr
		}
		for _, key := range keys {
			data, getErr := s.rdb.Get(ctx, key).Bytes()
			if getErr != nil {
				if getErr == redis.Nil {
					continue
				}
				return getErr
			}
			var task service.ImageTaskRecord
			if json.Unmarshal(data, &task) != nil || imageTaskCompleted(&task) {
				continue
			}
			pendingTasks = append(pendingTasks, redis.Z{
				Score:  float64(task.CreatedAt),
				Member: task.ID,
			})
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	pipe := s.rdb.TxPipeline()
	if len(pendingTasks) > 0 {
		pipe.ZAdd(ctx, imageTaskPendingKey, pendingTasks...)
	}
	pipe.Set(ctx, imageTaskPendingIndexReadyKey, "1", 0)
	_, err = pipe.Exec(ctx)
	return err
}

func imageTaskCompleted(task *service.ImageTaskRecord) bool {
	return task == nil ||
		task.CompletedAt != nil ||
		task.Status == service.ImageTaskStatusReady ||
		task.Status == service.ImageTaskStatusCompleted ||
		task.Status == service.ImageTaskStatusFailed
}

func (s *imageTaskStore) Claim(ctx context.Context, id, owner string, ttl time.Duration) (bool, error) {
	return s.rdb.SetNX(ctx, imageTaskLeaseKey(id), owner, ttl).Result()
}

func (s *imageTaskStore) RenewClaim(ctx context.Context, id, owner string, ttl time.Duration) (bool, error) {
	const script = `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("PEXPIRE", KEYS[1], ARGV[2])
		end
		return 0
	`
	result, err := s.rdb.Eval(ctx, script, []string{imageTaskLeaseKey(id)}, owner, ttl.Milliseconds()).Int()
	return result == 1, err
}

func (s *imageTaskStore) ReleaseClaim(ctx context.Context, id, owner string) error {
	const script = `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("DEL", KEYS[1])
		end
		return 0
	`
	return s.rdb.Eval(ctx, script, []string{imageTaskLeaseKey(id)}, owner).Err()
}

func (s *imageTaskStore) ClaimIdempotencyKey(
	ctx context.Context,
	apiKeyID int64,
	keyHash, taskID string,
	ttl time.Duration,
) (bool, error) {
	return s.rdb.SetNX(ctx, imageTaskIdempotencyKey(apiKeyID, keyHash), taskID, ttl).Result()
}

func (s *imageTaskStore) GetIdempotencyTaskID(ctx context.Context, apiKeyID int64, keyHash string) (string, error) {
	taskID, err := s.rdb.Get(ctx, imageTaskIdempotencyKey(apiKeyID, keyHash)).Result()
	if err == redis.Nil {
		return "", nil
	}
	return taskID, err
}

func (s *imageTaskStore) ReleaseIdempotencyKey(ctx context.Context, apiKeyID int64, keyHash, taskID string) error {
	const script = `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("DEL", KEYS[1])
		end
		return 0
	`
	return s.rdb.Eval(ctx, script, []string{imageTaskIdempotencyKey(apiKeyID, keyHash)}, taskID).Err()
}

func imageTaskKey(id string) string {
	return imageTaskKeyPrefix + strings.TrimSpace(id)
}

func imageTaskLeaseKey(id string) string {
	return imageTaskLeaseKeyPrefix + strings.TrimSpace(id)
}

func imageTaskIdempotencyKey(apiKeyID int64, keyHash string) string {
	return imageTaskIdempotencyKeyPrefix + strconv.FormatInt(apiKeyID, 10) + ":" + strings.TrimSpace(keyHash)
}
