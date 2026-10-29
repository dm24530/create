package repository

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/google/uuid"
)

type usageLogImageLinkStore struct {
	sqlDB *sql.DB
}

func NewUsageLogImageLinkStore(sqlDB *sql.DB) service.UsageLogImageLinkStore {
	return &usageLogImageLinkStore{sqlDB: sqlDB}
}

func (s *usageLogImageLinkStore) Upsert(ctx context.Context, link *service.UsageLogImageLink) error {
	if link == nil {
		return nil
	}
	requestID := strings.TrimSpace(link.RequestID)
	imageURL := strings.TrimSpace(link.ImageURL)
	objectKey := strings.TrimSpace(link.ObjectKey)
	if link.UserID <= 0 || link.APIKeyID <= 0 || requestID == "" || imageURL == "" {
		return nil
	}
	linkToken := newUsageLogImageLinkToken()
	expiresAt := link.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = time.Now().Add(service.UsageLogImageLinkTTL)
	}
	_, err := s.sqlDB.ExecContext(ctx, `
		INSERT INTO usage_log_image_links (
			user_id, api_key_id, request_id, link_token, image_url, object_key, expires_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		ON CONFLICT (user_id, api_key_id, request_id) DO UPDATE
		SET link_token = EXCLUDED.link_token,
		    image_url = EXCLUDED.image_url,
		    object_key = EXCLUDED.object_key,
		    expires_at = EXCLUDED.expires_at,
		    updated_at = NOW()
	`, link.UserID, link.APIKeyID, requestID, linkToken, imageURL, objectKey, expiresAt)
	return err
}

func (s *usageLogImageLinkStore) GetByToken(ctx context.Context, token string) (*service.UsageLogImageLink, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, service.ErrUsageLogImageLinkNotFound
	}
	var link service.UsageLogImageLink
	var objectKey sql.NullString
	var displayedAt sql.NullTime
	var generationDurationMs sql.NullInt64
	err := s.sqlDB.QueryRowContext(ctx, `
		SELECT user_id, api_key_id, request_id, link_token, image_url, object_key, expires_at,
		       displayed_at, generation_duration_ms
		FROM usage_log_image_links
		WHERE link_token = $1 AND expires_at > NOW()
	`, token).Scan(
		&link.UserID,
		&link.APIKeyID,
		&link.RequestID,
		&link.LinkToken,
		&link.ImageURL,
		&objectKey,
		&link.ExpiresAt,
		&displayedAt,
		&generationDurationMs,
	)
	if err == sql.ErrNoRows {
		return nil, service.ErrUsageLogImageLinkNotFound
	}
	if err != nil {
		return nil, err
	}
	if objectKey.Valid {
		link.ObjectKey = objectKey.String
	}
	if displayedAt.Valid {
		value := displayedAt.Time
		link.DisplayedAt = &value
	}
	if generationDurationMs.Valid {
		value := int(generationDurationMs.Int64)
		link.GenerationDurationMs = &value
	}
	return &link, nil
}

func (s *usageLogImageLinkStore) MarkGenerationDuration(
	ctx context.Context,
	userID, apiKeyID int64,
	requestID string,
	durationMs int,
) error {
	requestID = strings.TrimSpace(requestID)
	if userID <= 0 || apiKeyID <= 0 || requestID == "" || durationMs <= 0 {
		return nil
	}
	_, err := s.sqlDB.ExecContext(ctx, `
		INSERT INTO image_generation_metrics (
			user_id, api_key_id, request_id, generation_duration_ms, completed_at
		)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, api_key_id, request_id) DO UPDATE
		SET generation_duration_ms = COALESCE(
		        image_generation_metrics.generation_duration_ms,
		        EXCLUDED.generation_duration_ms
		    ),
		    completed_at = COALESCE(image_generation_metrics.completed_at, EXCLUDED.completed_at),
		    updated_at = NOW()
	`, userID, apiKeyID, requestID, durationMs)
	if err != nil {
		return err
	}
	_, err = s.sqlDB.ExecContext(ctx, `
		UPDATE usage_log_image_links
		SET generation_duration_ms = COALESCE(generation_duration_ms, $4),
		    updated_at = NOW()
		WHERE user_id = $1 AND api_key_id = $2 AND request_id = $3
	`, userID, apiKeyID, requestID, durationMs)
	return err
}

func (s *usageLogImageLinkStore) MarkDisplayed(
	ctx context.Context,
	userID, apiKeyID int64,
	requestID string,
	displayedAt time.Time,
) error {
	requestID = strings.TrimSpace(requestID)
	if userID <= 0 || apiKeyID <= 0 || requestID == "" {
		return nil
	}
	if displayedAt.IsZero() {
		displayedAt = time.Now().UTC()
	}
	_, err := s.sqlDB.ExecContext(ctx, `
		UPDATE usage_log_image_links
		SET displayed_at = COALESCE(displayed_at, $4),
		    updated_at = NOW()
		WHERE user_id = $1 AND api_key_id = $2 AND request_id = $3
	`, userID, apiKeyID, requestID, displayedAt)
	return err
}

func (s *usageLogImageLinkStore) DeleteExpired(ctx context.Context, now time.Time, limit int) (int64, error) {
	if limit <= 0 {
		limit = 500
	}
	result, err := s.sqlDB.ExecContext(ctx, `
		DELETE FROM usage_log_image_links
		WHERE (user_id, api_key_id, request_id) IN (
			SELECT user_id, api_key_id, request_id
			FROM usage_log_image_links
			WHERE expires_at <= $1
			ORDER BY expires_at
			LIMIT $2
		)
	`, now, limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func newUsageLogImageLinkToken() string {
	return strings.ReplaceAll(uuid.NewString(), "-", "")
}
