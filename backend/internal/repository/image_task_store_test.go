package repository

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestImageTaskStoreRoundTripAndTTL(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := NewImageTaskStore(rdb)
	task := &service.ImageTaskRecord{
		ID:        "imgtask_123",
		UserID:    7,
		APIKeyID:  9,
		Status:    service.ImageTaskStatusProcessing,
		CreatedAt: 100,
		ExpiresAt: 200,
	}

	require.NoError(t, store.Save(context.Background(), task, 24*time.Hour))
	got, err := store.Get(context.Background(), task.ID)
	require.NoError(t, err)
	require.Equal(t, task, got)
	require.Equal(t, 24*time.Hour, mr.TTL(imageTaskKey(task.ID)))
}

func TestImageTaskStoreMissing(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := NewImageTaskStore(rdb)

	_, err := store.Get(context.Background(), "imgtask_missing")
	require.ErrorIs(t, err, service.ErrImageTaskNotFound)
}

func TestImageTaskStoreListPendingSkipsFinishedTasks(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := NewImageTaskStore(rdb)
	ctx := context.Background()

	processing := &service.ImageTaskRecord{
		ID:        "imgtask_processing",
		Status:    service.ImageTaskStatusProcessing,
		CreatedAt: 100,
		ExpiresAt: 200,
		Execution: &service.ImageTaskExecution{Platform: service.PlatformOpenAI},
	}
	completedAt := int64(150)
	completed := &service.ImageTaskRecord{
		ID:          "imgtask_completed",
		Status:      service.ImageTaskStatusProcessing,
		CreatedAt:   100,
		CompletedAt: &completedAt,
		ExpiresAt:   200,
	}
	failed := &service.ImageTaskRecord{
		ID:        "imgtask_failed",
		Status:    service.ImageTaskStatusFailed,
		CreatedAt: 100,
		ExpiresAt: 200,
	}
	require.NoError(t, store.Save(ctx, processing, time.Hour))
	require.NoError(t, store.Save(ctx, completed, time.Hour))
	require.NoError(t, store.Save(ctx, failed, time.Hour))

	tasks, err := store.ListPending(ctx, 10)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	require.Equal(t, processing.ID, tasks[0].ID)
	require.NotNil(t, tasks[0].Execution)
	pendingCount, err := rdb.ZCard(ctx, imageTaskPendingKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(1), pendingCount)
}

func TestImageTaskStoreCompletedTaskLeavesPendingIndex(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := NewImageTaskStore(rdb)
	ctx := context.Background()
	task := &service.ImageTaskRecord{
		ID:        "imgtask_finish",
		Status:    service.ImageTaskStatusProcessing,
		CreatedAt: 100,
		ExpiresAt: 200,
	}
	require.NoError(t, store.Save(ctx, task, time.Hour))
	pendingCount, err := rdb.ZCard(ctx, imageTaskPendingKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(1), pendingCount)

	completedAt := int64(150)
	task.Status = service.ImageTaskStatusCompleted
	task.CompletedAt = &completedAt
	require.NoError(t, store.Save(ctx, task, time.Hour))

	pendingCount, err = rdb.ZCard(ctx, imageTaskPendingKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(0), pendingCount)
	tasks, err := store.ListPending(ctx, 10)
	require.NoError(t, err)
	require.Empty(t, tasks)
}

func TestImageTaskStorePendingIndexMigratesExistingTasks(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := NewImageTaskStore(rdb)
	ctx := context.Background()
	task := &service.ImageTaskRecord{
		ID:        "imgtask_existing",
		Status:    service.ImageTaskStatusProcessing,
		CreatedAt: 100,
		ExpiresAt: 200,
	}
	data, err := json.Marshal(task)
	require.NoError(t, err)
	require.NoError(t, rdb.Set(ctx, imageTaskKey(task.ID), data, time.Hour).Err())

	tasks, err := store.ListPending(ctx, 10)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	require.Equal(t, task.ID, tasks[0].ID)
	pendingCount, err := rdb.ZCard(ctx, imageTaskPendingKey).Result()
	require.NoError(t, err)
	require.Equal(t, int64(1), pendingCount)
}

func TestImageTaskStoreLeasePreventsDuplicateExecution(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := NewImageTaskStore(rdb)
	ctx := context.Background()

	claimed, err := store.Claim(ctx, "imgtask_lease", "worker-a", time.Minute)
	require.NoError(t, err)
	require.True(t, claimed)

	claimed, err = store.Claim(ctx, "imgtask_lease", "worker-b", time.Minute)
	require.NoError(t, err)
	require.False(t, claimed)

	renewed, err := store.RenewClaim(ctx, "imgtask_lease", "worker-b", time.Minute)
	require.NoError(t, err)
	require.False(t, renewed)

	renewed, err = store.RenewClaim(ctx, "imgtask_lease", "worker-a", time.Minute)
	require.NoError(t, err)
	require.True(t, renewed)

	require.NoError(t, store.ReleaseClaim(ctx, "imgtask_lease", "worker-b"))
	claimed, err = store.Claim(ctx, "imgtask_lease", "worker-b", time.Minute)
	require.NoError(t, err)
	require.False(t, claimed)

	require.NoError(t, store.ReleaseClaim(ctx, "imgtask_lease", "worker-a"))
	claimed, err = store.Claim(ctx, "imgtask_lease", "worker-b", time.Minute)
	require.NoError(t, err)
	require.True(t, claimed)
}

func TestImageTaskStoreIdempotencyMapping(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := NewImageTaskStore(rdb)
	ctx := context.Background()

	claimed, err := store.ClaimIdempotencyKey(ctx, 9, "request-hash", "imgtask_a", time.Hour)
	require.NoError(t, err)
	require.True(t, claimed)

	claimed, err = store.ClaimIdempotencyKey(ctx, 9, "request-hash", "imgtask_b", time.Hour)
	require.NoError(t, err)
	require.False(t, claimed)
	taskID, err := store.GetIdempotencyTaskID(ctx, 9, "request-hash")
	require.NoError(t, err)
	require.Equal(t, "imgtask_a", taskID)

	require.NoError(t, store.ReleaseIdempotencyKey(ctx, 9, "request-hash", "imgtask_b"))
	taskID, err = store.GetIdempotencyTaskID(ctx, 9, "request-hash")
	require.NoError(t, err)
	require.Equal(t, "imgtask_a", taskID)

	require.NoError(t, store.ReleaseIdempotencyKey(ctx, 9, "request-hash", "imgtask_a"))
	taskID, err = store.GetIdempotencyTaskID(ctx, 9, "request-hash")
	require.NoError(t, err)
	require.Empty(t, taskID)
}
