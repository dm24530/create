package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
)

var userStorageKeyPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

var ErrUserStorageKeyUnavailable = errors.New("user storage key unavailable")

type UserStorageIdentityResolver interface {
	StorageKey(ctx context.Context, userID int64) (string, error)
}

// UserStorageIdentityService resolves the stable random namespace used in
// object-store paths. It deliberately keeps the numeric user ID internal.
type UserStorageIdentityService struct {
	db *sql.DB

	mu    sync.RWMutex
	cache map[int64]string
}

func NewUserStorageIdentityService(db *sql.DB) *UserStorageIdentityService {
	return &UserStorageIdentityService{db: db, cache: make(map[int64]string)}
}

func (s *UserStorageIdentityService) StorageKey(ctx context.Context, userID int64) (string, error) {
	if s == nil || s.db == nil || userID <= 0 {
		return "", ErrUserStorageKeyUnavailable
	}
	s.mu.RLock()
	key := s.cache[userID]
	s.mu.RUnlock()
	if userStorageKeyPattern.MatchString(key) {
		return key, nil
	}

	err := s.db.QueryRowContext(ctx, `SELECT storage_key FROM users WHERE id = $1`, userID).Scan(&key)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load user storage key: %w", err)
	}
	if !userStorageKeyPattern.MatchString(strings.TrimSpace(key)) {
		generated, genErr := generateUserStorageKey()
		if genErr != nil {
			return "", genErr
		}
		err = s.db.QueryRowContext(ctx, `
			UPDATE users
			SET storage_key = $2
			WHERE id = $1
			  AND (storage_key IS NULL OR storage_key = '' OR storage_key !~ '^[a-f0-9]{32}$')
			RETURNING storage_key
		`, userID, generated).Scan(&key)
		if errors.Is(err, sql.ErrNoRows) {
			err = s.db.QueryRowContext(ctx, `SELECT storage_key FROM users WHERE id = $1`, userID).Scan(&key)
		}
		if err != nil {
			return "", fmt.Errorf("assign user storage key: %w", err)
		}
	}

	key = strings.TrimSpace(key)
	if !userStorageKeyPattern.MatchString(key) {
		return "", fmt.Errorf("%w: invalid stored key", ErrUserStorageKeyUnavailable)
	}
	s.mu.Lock()
	s.cache[userID] = key
	s.mu.Unlock()
	return key, nil
}

func generateUserStorageKey() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate user storage key: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}
