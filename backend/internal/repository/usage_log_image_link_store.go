package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
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
	linkToken := usageLogImageLinkToken(link.UserID, link.APIKeyID, requestID)
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
	err := s.sqlDB.QueryRowContext(ctx, `
		SELECT user_id, api_key_id, request_id, link_token, image_url, object_key, expires_at
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
	return &link, nil
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

func usageLogImageLinkToken(userID, apiKeyID int64, requestID string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%s", userID, apiKeyID, strings.TrimSpace(requestID))))
	return fmt.Sprintf("%x", sum[:])
}
