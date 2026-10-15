package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

// studio_works 是图片图库与视频「我的作品」的唯一持久化存储。
//
// 两种作品共用一张表，用 kind 区分；配额计数刻意不带 kind 条件，
// 所以「每人 100 个文件」是图片 + 视频合并计算的。
const studioWorksColumns = `
	id, user_id, kind, object_key, url, prompt, model, format, size, duration_seconds,
	EXTRACT(EPOCH FROM created_at)::bigint AS created_at`

type studioWorksDB struct {
	db *sql.DB
}

// insert 把一行作品写进表里，并在同一个事务内先核对配额。
//
// 之前是在服务层"先 Count 再 INSERT"，两步之间别的请求可以插进来，配额于是能被
// 并发提交突破。这里改成：事务 + 按用户加咨询锁 → 计数 → 插入，同一用户的写入被
// 串行化，配额就是硬上限。
func (s *studioWorksDB) insert(ctx context.Context, entry *studioWorkRow, quota int64) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("studio works store is unavailable")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin studio work tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// 咨询锁跟着事务走，事务结束自动释放；键用用户 ID，互不相干。
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, studioWorksLockKey(entry.UserID)); err != nil {
		return fmt.Errorf("lock studio works for user: %w", err)
	}

	if quota > 0 {
		var used int64
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM studio_works WHERE user_id = $1`, entry.UserID,
		).Scan(&used); err != nil {
			return fmt.Errorf("count studio works: %w", err)
		}
		if used >= quota {
			return service.ErrStudioWorksQuotaExceeded
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO studio_works (
			id, user_id, kind, object_key, url, prompt, model, format, size, duration_seconds
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		entry.ID, entry.UserID, entry.Kind, entry.ObjectKey, entry.URL, entry.Prompt,
		entry.Model, entry.Format, entry.Size, entry.DurationSeconds,
	); err != nil {
		return fmt.Errorf("insert studio work: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit studio work: %w", err)
	}
	return nil
}

// studioWorksLockKey 把用户 ID 映射成咨询锁的键空间，避免和其他模块的锁撞车。
const studioWorksLockKeyNamespace int64 = 0x5731_4B53 // 'W1KS'

func studioWorksLockKey(userID int64) int64 {
	return studioWorksLockKeyNamespace*1_000_000 + userID
}

func (s *studioWorksDB) list(ctx context.Context, userID int64, kind string, limit int) ([]*studioWorkRow, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("studio works store is unavailable")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT`+studioWorksColumns+`
		FROM studio_works
		WHERE user_id = $1 AND kind = $2
		ORDER BY created_at DESC
		LIMIT $3`, userID, kind, limit)
	if err != nil {
		return nil, fmt.Errorf("list studio works: %w", err)
	}
	defer func() { _ = rows.Close() }()

	entries := make([]*studioWorkRow, 0, limit)
	for rows.Next() {
		entry := &studioWorkRow{}
		if err := rows.Scan(
			&entry.ID, &entry.UserID, &entry.Kind, &entry.ObjectKey, &entry.URL, &entry.Prompt,
			&entry.Model, &entry.Format, &entry.Size, &entry.DurationSeconds, &entry.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan studio work: %w", err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate studio works: %w", err)
	}
	return entries, nil
}

// count 统计该用户全部作品（图片 + 视频），配额就按这个数判定。
func (s *studioWorksDB) count(ctx context.Context, userID int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, fmt.Errorf("studio works store is unavailable")
	}
	var total int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM studio_works WHERE user_id = $1`, userID,
	).Scan(&total); err != nil {
		return 0, fmt.Errorf("count studio works: %w", err)
	}
	return total, nil
}

func (s *studioWorksDB) objectKey(ctx context.Context, userID int64, id string) (string, error) {
	if s == nil || s.db == nil {
		return "", fmt.Errorf("studio works store is unavailable")
	}
	var key string
	err := s.db.QueryRowContext(ctx,
		`SELECT object_key FROM studio_works WHERE user_id = $1 AND id = $2`, userID, id,
	).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", service.ErrStudioWorkNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load studio work object key: %w", err)
	}
	return key, nil
}

func (s *studioWorksDB) delete(ctx context.Context, userID int64, id string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("studio works store is unavailable")
	}
	result, err := s.db.ExecContext(ctx,
		`DELETE FROM studio_works WHERE user_id = $1 AND id = $2`, userID, id)
	if err != nil {
		return fmt.Errorf("delete studio work: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete studio work: %w", err)
	}
	if affected == 0 {
		return service.ErrStudioWorkNotFound
	}
	return nil
}

// studioWorkRow 是表行的中性形态，两个 store 各自映射到自己的 entry 类型。
type studioWorkRow struct {
	ID              string
	UserID          int64
	Kind            string
	ObjectKey       string
	URL             string
	Prompt          string
	Model           string
	Format          string
	Size            string
	DurationSeconds int
	CreatedAt       int64
}

/* ------------------------------- 图片图库 ------------------------------- */

type imageStudioGalleryStore struct {
	*studioWorksDB
}

func NewImageStudioGalleryStore(db *sql.DB) service.ImageStudioGalleryStore {
	return &imageStudioGalleryStore{studioWorksDB: &studioWorksDB{db: db}}
}

func (s *imageStudioGalleryStore) Save(
	ctx context.Context, entry *service.ImageStudioGalleryEntry, quota int64,
) error {
	if entry == nil {
		return fmt.Errorf("studio work entry is nil")
	}
	return s.insert(ctx, &studioWorkRow{
		ID:        entry.ID,
		UserID:    entry.UserID,
		Kind:      "image",
		ObjectKey: entry.ObjectKey,
		URL:       entry.URL,
		Prompt:    entry.Prompt,
		Model:     entry.Model,
		Format:    entry.Format,
		Size:      entry.Size,
	}, quota)
}

func (s *imageStudioGalleryStore) List(
	ctx context.Context, userID int64, limit int,
) ([]*service.ImageStudioGalleryEntry, error) {
	rows, err := s.list(ctx, userID, "image", limit)
	if err != nil {
		return nil, err
	}
	entries := make([]*service.ImageStudioGalleryEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, &service.ImageStudioGalleryEntry{
			ID:        row.ID,
			UserID:    row.UserID,
			ObjectKey: row.ObjectKey,
			URL:       row.URL,
			Prompt:    row.Prompt,
			Model:     row.Model,
			Size:      row.Size,
			Format:    row.Format,
			CreatedAt: row.CreatedAt,
		})
	}
	return entries, nil
}

func (s *imageStudioGalleryStore) Count(ctx context.Context, userID int64) (int64, error) {
	return s.count(ctx, userID)
}

func (s *imageStudioGalleryStore) ObjectKey(ctx context.Context, userID int64, id string) (string, error) {
	return s.objectKey(ctx, userID, id)
}

func (s *imageStudioGalleryStore) Delete(ctx context.Context, userID int64, id string) error {
	return s.delete(ctx, userID, id)
}

/* ------------------------------ 视频作品库 ------------------------------ */

type videoStudioGalleryStore struct {
	*studioWorksDB
}

func NewVideoStudioGalleryStore(db *sql.DB) service.VideoStudioGalleryStore {
	return &videoStudioGalleryStore{studioWorksDB: &studioWorksDB{db: db}}
}

func (s *videoStudioGalleryStore) Save(
	ctx context.Context, entry *service.VideoStudioGalleryEntry, quota int64,
) error {
	if entry == nil {
		return fmt.Errorf("studio work entry is nil")
	}
	return s.insert(ctx, &studioWorkRow{
		ID:              entry.ID,
		UserID:          entry.UserID,
		Kind:            "video",
		ObjectKey:       entry.ObjectKey,
		URL:             entry.URL,
		Prompt:          entry.Prompt,
		Model:           entry.Model,
		Format:          entry.Format,
		DurationSeconds: entry.DurationSeconds,
	}, quota)
}

func (s *videoStudioGalleryStore) List(
	ctx context.Context, userID int64, limit int,
) ([]*service.VideoStudioGalleryEntry, error) {
	rows, err := s.list(ctx, userID, "video", limit)
	if err != nil {
		return nil, err
	}
	entries := make([]*service.VideoStudioGalleryEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, &service.VideoStudioGalleryEntry{
			ID:              row.ID,
			UserID:          row.UserID,
			ObjectKey:       row.ObjectKey,
			URL:             row.URL,
			Prompt:          row.Prompt,
			Model:           row.Model,
			Format:          row.Format,
			DurationSeconds: row.DurationSeconds,
			CreatedAt:       row.CreatedAt,
		})
	}
	return entries, nil
}

func (s *videoStudioGalleryStore) Count(ctx context.Context, userID int64) (int64, error) {
	return s.count(ctx, userID)
}

func (s *videoStudioGalleryStore) ObjectKey(ctx context.Context, userID int64, id string) (string, error) {
	return s.objectKey(ctx, userID, id)
}

func (s *videoStudioGalleryStore) Delete(ctx context.Context, userID int64, id string) error {
	return s.delete(ctx, userID, id)
}
