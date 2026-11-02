package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
)

// studio_works 是图片图库与视频「我的作品」的唯一持久化存储。
//
// 两种作品共用一张表，用 kind 区分；配额计数刻意不带 kind 条件，
// 所以「每人 100 个文件」是图片 + 视频合并计算的。
const studioWorksColumns = `
	id, user_id, kind, source_id, object_key, url, thumb_url, thumb_object_key, prompt, model, format, size, duration_seconds, duration_ms, saved, sort_order,
	EXTRACT(EPOCH FROM created_at)::bigint AS created_at,
	COALESCE(EXTRACT(EPOCH FROM expires_at)::bigint, 0) AS expires_at`

// Older rows stored sort_order as milliseconds or seconds, while current
// clients use microseconds. Normalize while ordering so legacy works do not
// jump ahead of or behind newly generated slots.
const studioWorksOrderExpression = `
	CASE
		WHEN sort_order >= 100000000000000 THEN sort_order
		WHEN sort_order >= 100000000000 THEN sort_order * 1000
		WHEN sort_order > 0 THEN sort_order * 1000000
		ELSE EXTRACT(EPOCH FROM created_at)::bigint * 1000000
	END`

type studioWorksDB struct {
	db *sql.DB
}

// studioWorkExpiry 把"Unix 秒的过期时间"转成可空的库值：0 表示长期有效（NULL）。
func studioWorkExpiry(expiresAt int64) any {
	if expiresAt <= 0 {
		return nil
	}
	return time.Unix(expiresAt, 0).UTC()
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

	if entry.SourceID != "" {
		var exists bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM studio_works
				WHERE user_id = $1 AND kind = $2 AND source_id = $3
			)`,
			entry.UserID, entry.Kind, entry.SourceID,
		).Scan(&exists); err != nil {
			return fmt.Errorf("check studio work source: %w", err)
		}
		if exists {
			return service.ErrStudioWorkAlreadyExists
		}
	}

	// 配额只约束"存到我的作品"的条目：没保存的临时内容到期会被清扫，不计入 100。
	if quota > 0 && entry.Saved {
		var used int64
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM studio_works WHERE user_id = $1 AND saved = TRUE`, entry.UserID,
		).Scan(&used); err != nil {
			return fmt.Errorf("count studio works: %w", err)
		}
		if used >= quota {
			return service.ErrStudioWorksQuotaExceeded
		}
	}
	// 临时内容不占配额，但要有堆积上限，否则刷生成就能把桶撑爆。
	if !entry.Saved {
		var pending int64
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM studio_works WHERE user_id = $1 AND saved = FALSE`, entry.UserID,
		).Scan(&pending); err != nil {
			return fmt.Errorf("count temporary studio works: %w", err)
		}
		if pending >= service.StudioWorksTempLimit {
			return service.ErrStudioWorksTempLimitExceeded
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO studio_works (
			id, user_id, kind, source_id, object_key, url, thumb_url, thumb_object_key, prompt, model, format, size, duration_seconds, duration_ms, saved, sort_order, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
		entry.ID, entry.UserID, entry.Kind, entry.SourceID, entry.ObjectKey, entry.URL, entry.ThumbURL, entry.ThumbObjectKey, entry.Prompt,
		entry.Model, entry.Format, entry.Size, entry.DurationSeconds, entry.DurationMs, entry.Saved, entry.SortOrder, studioWorkExpiry(entry.ExpiresAt),
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

// list 取某个用户某一类作品。saved 为 nil 表示不过滤（图片工作台会同时展示临时与已保存）。
func (s *studioWorksDB) list(
	ctx context.Context, userID int64, kind string, saved *bool, limit int,
) ([]*studioWorkRow, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("studio works store is unavailable")
	}
	query := `
		SELECT` + studioWorksColumns + `
		FROM studio_works
		WHERE user_id = $1 AND kind = $2
		  AND (saved = TRUE OR expires_at IS NULL OR expires_at > NOW())`
	args := []any{userID, kind}
	if saved != nil {
		query += fmt.Sprintf(" AND saved = $%d", len(args)+1)
		args = append(args, *saved)
	}
	query += fmt.Sprintf(" ORDER BY "+studioWorksOrderExpression+" DESC, created_at DESC, id DESC LIMIT $%d", len(args)+1)
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list studio works: %w", err)
	}
	defer func() { _ = rows.Close() }()

	entries := make([]*studioWorkRow, 0, limit)
	for rows.Next() {
		entry := &studioWorkRow{}
		if err := rows.Scan(
			&entry.ID, &entry.UserID, &entry.Kind, &entry.SourceID, &entry.ObjectKey, &entry.URL, &entry.ThumbURL, &entry.ThumbObjectKey, &entry.Prompt,
			&entry.Model, &entry.Format, &entry.Size, &entry.DurationSeconds, &entry.DurationMs, &entry.Saved, &entry.SortOrder,
			&entry.CreatedAt, &entry.ExpiresAt,
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

// count 统计配额用量：只算"存到我的作品"的条目（图片 + 视频合计），
// 临时内容到期会被清扫，不占配额。
func (s *studioWorksDB) count(ctx context.Context, userID int64) (int64, error) {
	if s == nil || s.db == nil {
		return 0, fmt.Errorf("studio works store is unavailable")
	}
	var total int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM studio_works WHERE user_id = $1 AND saved = TRUE`, userID,
	).Scan(&total); err != nil {
		return 0, fmt.Errorf("count studio works: %w", err)
	}
	return total, nil
}

// pin 把一条临时作品转成"存到我的作品"：先在同一事务里对用户加锁、核对配额，
// 通过后清掉过期时间。已经是已保存状态时直接成功（幂等）。
func (s *studioWorksDB) pin(ctx context.Context, userID int64, id string, quota int64) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("studio works store is unavailable")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin pin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, studioWorksLockKey(userID)); err != nil {
		return fmt.Errorf("lock studio works for user: %w", err)
	}

	var alreadySaved bool
	var expiresAt sql.NullTime
	err = tx.QueryRowContext(ctx,
		`SELECT saved, expires_at FROM studio_works WHERE user_id = $1 AND id = $2`, userID, id,
	).Scan(&alreadySaved, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return service.ErrStudioWorkNotFound
	}
	if err != nil {
		return fmt.Errorf("load studio work: %w", err)
	}
	if alreadySaved {
		return nil
	}
	if expiresAt.Valid && !expiresAt.Time.After(time.Now()) {
		return service.ErrStudioWorkExpired
	}

	if quota > 0 {
		var used int64
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM studio_works WHERE user_id = $1 AND saved = TRUE`, userID,
		).Scan(&used); err != nil {
			return fmt.Errorf("count studio works: %w", err)
		}
		if used >= quota {
			return service.ErrStudioWorksQuotaExceeded
		}
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE studio_works SET saved = TRUE, expires_at = NULL WHERE user_id = $1 AND id = $2`,
		userID, id,
	); err != nil {
		return fmt.Errorf("pin studio work: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit pin studio work: %w", err)
	}
	return nil
}

// unpin 把已保存作品转回临时内容。作品不存在时返回统一错误；重复调用成功。
func (s *studioWorksDB) unpin(ctx context.Context, userID int64, id string, expiresAt int64) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("studio works store is unavailable")
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE studio_works
		SET saved = FALSE, expires_at = $3
		WHERE user_id = $1 AND id = $2 AND saved = TRUE`,
		userID, id, studioWorkExpiry(expiresAt),
	)
	if err != nil {
		return fmt.Errorf("unpin studio work: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("unpin studio work: %w", err)
	}
	if affected == 0 {
		var exists bool
		if err := s.db.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM studio_works WHERE user_id = $1 AND id = $2)`,
			userID, id,
		).Scan(&exists); err != nil {
			return fmt.Errorf("check studio work: %w", err)
		}
		if !exists {
			return service.ErrStudioWorkNotFound
		}
	}
	return nil
}

func (s *studioWorksDB) listExpired(ctx context.Context, batch int) ([]service.ExpiredStudioWork, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("studio works store is unavailable")
	}
	if batch <= 0 {
		batch = 200
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, object_key, thumb_object_key
		FROM studio_works
		WHERE saved = FALSE AND expires_at IS NOT NULL AND expires_at <= NOW()
		ORDER BY expires_at ASC
		LIMIT $1`, batch)
	if err != nil {
		return nil, fmt.Errorf("list expired studio works: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := make([]service.ExpiredStudioWork, 0, batch)
	for rows.Next() {
		var item service.ExpiredStudioWork
		var objectKey, thumbObjectKey sql.NullString
		if err := rows.Scan(&item.ID, &objectKey, &thumbObjectKey); err != nil {
			return nil, fmt.Errorf("scan expired studio work: %w", err)
		}
		if objectKey.Valid {
			item.ObjectKey = strings.TrimSpace(objectKey.String)
		}
		if thumbObjectKey.Valid {
			item.ThumbObjectKey = strings.TrimSpace(thumbObjectKey.String)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate swept studio works: %w", err)
	}
	return items, nil
}

func (s *studioWorksDB) deleteExpiredByIDs(ctx context.Context, ids []string) (int, error) {
	if s == nil || s.db == nil {
		return 0, fmt.Errorf("studio works store is unavailable")
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM studio_works
		WHERE saved = FALSE AND id = ANY($1)`, pq.Array(ids))
	if err != nil {
		return 0, fmt.Errorf("delete expired studio works: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(affected), nil
}

func (s *studioWorksDB) reconcileTemporaryExpiry(
	ctx context.Context,
	imageRetentionSeconds, videoRetentionSeconds int64,
) (int64, error) {
	if s == nil || s.db == nil {
		return 0, fmt.Errorf("studio works store is unavailable")
	}
	if imageRetentionSeconds <= 0 || videoRetentionSeconds <= 0 {
		return 0, nil
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE studio_works
		SET expires_at = created_at + (
			CASE WHEN kind = 'video' THEN $2 ELSE $1 END * INTERVAL '1 second'
		)
		WHERE saved = FALSE
		  AND expires_at IS NOT NULL
		  AND expires_at IS DISTINCT FROM created_at + (
			CASE WHEN kind = 'video' THEN $2 ELSE $1 END * INTERVAL '1 second'
		  )`,
		imageRetentionSeconds,
		videoRetentionSeconds)
	if err != nil {
		return 0, fmt.Errorf("reconcile temporary studio work expiry: %w", err)
	}
	return result.RowsAffected()
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

func (s *studioWorksDB) updateThumb(
	ctx context.Context,
	userID int64,
	id, thumbURL, thumbObjectKey string,
) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("studio works store is unavailable")
	}
	result, err := s.db.ExecContext(ctx,
		`UPDATE studio_works SET thumb_url = $3, thumb_object_key = $4 WHERE user_id = $1 AND id = $2`,
		userID, id, thumbURL, thumbObjectKey,
	)
	if err != nil {
		return fmt.Errorf("update studio work thumbnail: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update studio work thumbnail: %w", err)
	}
	if affected == 0 {
		return service.ErrStudioWorkNotFound
	}
	return nil
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
	SourceID        string
	ObjectKey       string
	URL             string
	ThumbURL        string
	ThumbObjectKey  string
	Prompt          string
	Model           string
	Format          string
	Size            string
	DurationSeconds int
	DurationMs      sql.NullInt64
	Saved           bool
	SortOrder       int64
	ExpiresAt       int64
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
		ID:             entry.ID,
		UserID:         entry.UserID,
		Kind:           "image",
		SourceID:       entry.SourceID,
		ObjectKey:      entry.ObjectKey,
		URL:            entry.URL,
		ThumbURL:       entry.ThumbURL,
		ThumbObjectKey: entry.ThumbObjectKey,
		Prompt:         entry.Prompt,
		Model:          entry.Model,
		Format:         entry.Format,
		Size:           entry.Size,
		DurationMs: sql.NullInt64{
			Int64: int64(entry.DurationMs),
			Valid: entry.DurationMs > 0,
		},
		Saved:     entry.Saved,
		SortOrder: entry.SortOrder,
		ExpiresAt: entry.ExpiresAt,
	}, quota)
}

func (s *imageStudioGalleryStore) List(
	ctx context.Context, userID int64, limit int, saved *bool,
) ([]*service.ImageStudioGalleryEntry, error) {
	rows, err := s.list(ctx, userID, "image", saved, limit)
	if err != nil {
		return nil, err
	}
	entries := make([]*service.ImageStudioGalleryEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, &service.ImageStudioGalleryEntry{
			ID:             row.ID,
			UserID:         row.UserID,
			SourceID:       row.SourceID,
			ObjectKey:      row.ObjectKey,
			URL:            row.URL,
			ThumbURL:       row.ThumbURL,
			ThumbObjectKey: row.ThumbObjectKey,
			Prompt:         row.Prompt,
			Model:          row.Model,
			Size:           row.Size,
			Format:         row.Format,
			DurationMs:     int(row.DurationMs.Int64),
			Saved:          row.Saved,
			SortOrder:      row.SortOrder,
			ExpiresAt:      row.ExpiresAt,
			CreatedAt:      row.CreatedAt,
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

func (s *imageStudioGalleryStore) FindBySourceID(
	ctx context.Context,
	userID int64,
	sourceID string,
) (*service.ImageStudioGalleryEntry, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT`+studioWorksColumns+`
		FROM studio_works
		WHERE user_id = $1 AND kind = 'image' AND source_id = $2`,
		userID, strings.TrimSpace(sourceID),
	)
	entry := &studioWorkRow{}
	if err := row.Scan(
		&entry.ID, &entry.UserID, &entry.Kind, &entry.SourceID, &entry.ObjectKey, &entry.URL, &entry.ThumbURL, &entry.ThumbObjectKey, &entry.Prompt,
		&entry.Model, &entry.Format, &entry.Size, &entry.DurationSeconds, &entry.DurationMs, &entry.Saved, &entry.SortOrder,
		&entry.CreatedAt, &entry.ExpiresAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, service.ErrStudioWorkNotFound
		}
		return nil, fmt.Errorf("find image studio work by source: %w", err)
	}
	return &service.ImageStudioGalleryEntry{
		ID:             entry.ID,
		UserID:         entry.UserID,
		SourceID:       entry.SourceID,
		ObjectKey:      entry.ObjectKey,
		URL:            entry.URL,
		ThumbURL:       entry.ThumbURL,
		ThumbObjectKey: entry.ThumbObjectKey,
		Prompt:         entry.Prompt,
		Model:          entry.Model,
		Size:           entry.Size,
		Format:         entry.Format,
		DurationMs:     int(entry.DurationMs.Int64),
		Saved:          entry.Saved,
		SortOrder:      entry.SortOrder,
		ExpiresAt:      entry.ExpiresAt,
		CreatedAt:      entry.CreatedAt,
	}, nil
}

func (s *imageStudioGalleryStore) UpdateThumb(
	ctx context.Context,
	userID int64,
	id, thumbURL, thumbObjectKey string,
) error {
	return s.updateThumb(ctx, userID, id, thumbURL, thumbObjectKey)
}

func (s *imageStudioGalleryStore) Delete(ctx context.Context, userID int64, id string) error {
	return s.delete(ctx, userID, id)
}

func (s *imageStudioGalleryStore) Pin(ctx context.Context, userID int64, id string, quota int64) error {
	return s.pin(ctx, userID, id, quota)
}

func (s *imageStudioGalleryStore) Unpin(ctx context.Context, userID int64, id string, expiresAt int64) error {
	return s.unpin(ctx, userID, id, expiresAt)
}

func (s *imageStudioGalleryStore) ListExpired(ctx context.Context, batch int) ([]service.ExpiredStudioWork, error) {
	return s.listExpired(ctx, batch)
}

func (s *imageStudioGalleryStore) DeleteExpiredByIDs(ctx context.Context, ids []string) (int, error) {
	return s.deleteExpiredByIDs(ctx, ids)
}

func (s *imageStudioGalleryStore) ReconcileTemporaryExpiry(
	ctx context.Context,
	imageRetentionSeconds, videoRetentionSeconds int64,
) (int64, error) {
	return s.reconcileTemporaryExpiry(ctx, imageRetentionSeconds, videoRetentionSeconds)
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
		Saved:           entry.Saved,
		SortOrder:       entry.SortOrder,
		ExpiresAt:       entry.ExpiresAt,
	}, quota)
}

func (s *videoStudioGalleryStore) List(
	ctx context.Context, userID int64, limit int, saved *bool,
) ([]*service.VideoStudioGalleryEntry, error) {
	rows, err := s.list(ctx, userID, "video", saved, limit)
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
			Saved:           row.Saved,
			SortOrder:       row.SortOrder,
			ExpiresAt:       row.ExpiresAt,
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

func (s *videoStudioGalleryStore) FindBySourceID(
	ctx context.Context,
	userID int64,
	sourceID string,
) (*service.VideoStudioGalleryEntry, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT`+studioWorksColumns+`
		FROM studio_works
		WHERE user_id = $1 AND kind = 'video' AND source_id = $2`,
		userID, strings.TrimSpace(sourceID),
	)
	entry := &studioWorkRow{}
	if err := row.Scan(
		&entry.ID, &entry.UserID, &entry.Kind, &entry.SourceID, &entry.ObjectKey, &entry.URL, &entry.ThumbURL, &entry.ThumbObjectKey, &entry.Prompt,
		&entry.Model, &entry.Format, &entry.Size, &entry.DurationSeconds, &entry.DurationMs, &entry.Saved, &entry.SortOrder,
		&entry.CreatedAt, &entry.ExpiresAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, service.ErrStudioWorkNotFound
		}
		return nil, fmt.Errorf("find studio work by source: %w", err)
	}
	return &service.VideoStudioGalleryEntry{
		ID:              entry.ID,
		UserID:          entry.UserID,
		SourceID:        entry.SourceID,
		ObjectKey:       entry.ObjectKey,
		URL:             entry.URL,
		Prompt:          entry.Prompt,
		Model:           entry.Model,
		Format:          entry.Format,
		DurationSeconds: entry.DurationSeconds,
		Saved:           entry.Saved,
		SortOrder:       entry.SortOrder,
		ExpiresAt:       entry.ExpiresAt,
		CreatedAt:       entry.CreatedAt,
	}, nil
}

func (s *videoStudioGalleryStore) Delete(ctx context.Context, userID int64, id string) error {
	return s.delete(ctx, userID, id)
}

func (s *videoStudioGalleryStore) Pin(ctx context.Context, userID int64, id string, quota int64) error {
	return s.pin(ctx, userID, id, quota)
}

func (s *videoStudioGalleryStore) Unpin(ctx context.Context, userID int64, id string, expiresAt int64) error {
	return s.unpin(ctx, userID, id, expiresAt)
}

func (s *videoStudioGalleryStore) ListExpired(ctx context.Context, batch int) ([]service.ExpiredStudioWork, error) {
	return s.listExpired(ctx, batch)
}

func (s *videoStudioGalleryStore) DeleteExpiredByIDs(ctx context.Context, ids []string) (int, error) {
	return s.deleteExpiredByIDs(ctx, ids)
}
