package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const LocalImageAssetURLPrefix = "/api/v1/public/image-assets/"

var localImageAssetIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

var ErrLocalImageAssetNotFound = errors.New("local image asset not found")

type LocalImageAssetMetadata struct {
	ID          string `json:"id"`
	UserID      int64  `json:"user_id"`
	TaskID      string `json:"task_id"`
	ObjectKey   string `json:"object_key"`
	ContentType string `json:"content_type"`
	FileName    string `json:"file_name"`
	Uploaded    bool   `json:"uploaded"`
	RemoteURL   string `json:"remote_url,omitempty"`
	CreatedAt   int64  `json:"created_at"`
	ExpiresAt   int64  `json:"expires_at,omitempty"`
}

// LocalImageAssetStore keeps the original image bytes on the application
// server so a task can finish before the remote object upload does.
type LocalImageAssetStore struct {
	root string
	mu   sync.Mutex
}

func NewLocalImageAssetStore(root string) *LocalImageAssetStore {
	root = strings.TrimSpace(root)
	if root == "" {
		root = filepath.Join(defaultLocalAssetDataDir(), "image-assets")
	}
	return &LocalImageAssetStore{root: filepath.Clean(root)}
}

func ProvideLocalImageAssetStore() *LocalImageAssetStore {
	return NewLocalImageAssetStore("")
}

func defaultLocalAssetDataDir() string {
	if value := strings.TrimSpace(os.Getenv("DATA_DIR")); value != "" {
		return value
	}
	return "data"
}

func (s *LocalImageAssetStore) Save(
	ctx context.Context,
	userID int64,
	taskID string,
	objectKey string,
	contentType string,
	expiresAt int64,
	data []byte,
) (*LocalImageAssetMetadata, error) {
	if s == nil || userID <= 0 || len(data) == 0 {
		return nil, ErrLocalImageAssetNotFound
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	id := strings.ReplaceAll(uuid.NewString(), "-", "")
	ext := extensionForContentType(contentType)
	fileName := id + ext
	userDir := filepath.Join(s.root, "users", fmt.Sprintf("%d", userID))
	if err := os.MkdirAll(userDir, 0o755); err != nil {
		return nil, fmt.Errorf("create local image asset directory: %w", err)
	}
	filePath := filepath.Join(userDir, fileName)
	if err := writeFileAtomic(filePath, data, 0o600); err != nil {
		return nil, fmt.Errorf("write local image asset: %w", err)
	}
	meta := &LocalImageAssetMetadata{
		ID:          id,
		UserID:      userID,
		TaskID:      strings.TrimSpace(taskID),
		ObjectKey:   strings.TrimSpace(objectKey),
		ContentType: strings.TrimSpace(contentType),
		FileName:    filepath.ToSlash(filepath.Join("users", fmt.Sprintf("%d", userID), fileName)),
		CreatedAt:   time.Now().UTC().Unix(),
		ExpiresAt:   expiresAt,
	}
	if err := s.writeMetadata(meta); err != nil {
		_ = os.Remove(filePath)
		return nil, err
	}
	return meta, nil
}

func (s *LocalImageAssetStore) URL(assetID string) string {
	return LocalImageAssetURLPrefix + strings.TrimSpace(assetID)
}

func (s *LocalImageAssetStore) IsAssetURL(rawURL string) bool {
	_, ok := s.AssetIDFromURL(rawURL)
	return ok
}

func (s *LocalImageAssetStore) AssetIDFromURL(rawURL string) (string, bool) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", false
	}
	if idx := strings.IndexAny(rawURL, "?#"); idx >= 0 {
		rawURL = rawURL[:idx]
	}
	if !strings.HasPrefix(rawURL, LocalImageAssetURLPrefix) {
		return "", false
	}
	id := strings.TrimPrefix(rawURL, LocalImageAssetURLPrefix)
	if strings.Contains(id, "/") || !localImageAssetIDPattern.MatchString(id) {
		return "", false
	}
	return id, true
}

func (s *LocalImageAssetStore) Get(assetID string) (*LocalImageAssetMetadata, error) {
	if s == nil || !localImageAssetIDPattern.MatchString(strings.TrimSpace(assetID)) {
		return nil, ErrLocalImageAssetNotFound
	}
	data, err := os.ReadFile(s.metadataPath(assetID))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrLocalImageAssetNotFound
		}
		return nil, err
	}
	var meta LocalImageAssetMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	if meta.ID != assetID {
		return nil, ErrLocalImageAssetNotFound
	}
	return &meta, nil
}

func (s *LocalImageAssetStore) Read(assetID string) (*LocalImageAssetMetadata, []byte, error) {
	meta, err := s.Get(assetID)
	if err != nil {
		return nil, nil, err
	}
	data, err := os.ReadFile(s.assetPath(meta))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, ErrLocalImageAssetNotFound
		}
		return nil, nil, err
	}
	return meta, data, nil
}

func (s *LocalImageAssetStore) Open(assetID string) (*LocalImageAssetMetadata, *os.File, error) {
	meta, err := s.Get(assetID)
	if err != nil {
		return nil, nil, err
	}
	file, err := os.Open(s.assetPath(meta))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, ErrLocalImageAssetNotFound
		}
		return nil, nil, err
	}
	return meta, file, nil
}

func (s *LocalImageAssetStore) ReadURL(ctx context.Context, rawURL string) ([]byte, string, bool, error) {
	id, ok := s.AssetIDFromURL(rawURL)
	if !ok {
		return nil, "", false, nil
	}
	meta, data, err := s.Read(id)
	if err != nil {
		return nil, "", true, err
	}
	if len(data) == 0 {
		return nil, "", true, ErrLocalImageAssetNotFound
	}
	if err := ctx.Err(); err != nil {
		return nil, "", true, err
	}
	return data, meta.ContentType, true, nil
}

func (s *LocalImageAssetStore) MarkUploaded(assetID, remoteURL string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.Get(assetID)
	if err != nil {
		return err
	}
	meta.Uploaded = true
	meta.RemoteURL = strings.TrimSpace(remoteURL)
	if err := s.writeMetadata(meta); err != nil {
		return err
	}
	// The public asset endpoint redirects to RemoteURL after this point, so the
	// large local copy is no longer needed.
	if err := os.Remove(s.assetPath(meta)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *LocalImageAssetStore) SetExpiryByURL(rawURL string, expiresAt int64) error {
	id, ok := s.AssetIDFromURL(rawURL)
	if !ok {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.Get(id)
	if err != nil {
		return err
	}
	meta.ExpiresAt = expiresAt
	return s.writeMetadata(meta)
}

func (s *LocalImageAssetStore) Delete(assetID string) error {
	if s == nil || !localImageAssetIDPattern.MatchString(strings.TrimSpace(assetID)) {
		return ErrLocalImageAssetNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	meta, err := s.Get(assetID)
	if err != nil {
		return err
	}
	if err := os.Remove(s.assetPath(meta)); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Remove(s.metadataPath(assetID)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *LocalImageAssetStore) IsUploadedURL(rawURL string) bool {
	id, ok := s.AssetIDFromURL(rawURL)
	if !ok {
		return false
	}
	meta, err := s.Get(id)
	return err == nil && meta.Uploaded && strings.TrimSpace(meta.RemoteURL) != ""
}

func (s *LocalImageAssetStore) ListPending(limit int) ([]*LocalImageAssetMetadata, error) {
	if s == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 100
	}
	entries, err := os.ReadDir(filepath.Join(s.root, "meta"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]*LocalImageAssetMetadata, 0, limit)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		meta, err := s.Get(id)
		if err != nil || meta.Uploaded {
			continue
		}
		if strings.TrimSpace(meta.ObjectKey) == "" {
			continue
		}
		out = append(out, meta)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// CleanupExpired removes expired local asset files and their metadata.
// Uploaded assets are typically metadata-only already; keeping those records
// after expiry serves no purpose.
func (s *LocalImageAssetStore) CleanupExpired(now time.Time, limit int) (int, error) {
	if s == nil {
		return 0, nil
	}
	if limit <= 0 {
		limit = 200
	}
	entries, err := os.ReadDir(filepath.Join(s.root, "meta"))
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	nowUnix := now.UTC().Unix()
	cleaned := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		meta, err := s.Get(id)
		if err != nil || meta.ExpiresAt <= 0 || meta.ExpiresAt > nowUnix {
			continue
		}
		if err := s.Delete(id); err != nil && !errors.Is(err, ErrLocalImageAssetNotFound) {
			return cleaned, err
		}
		cleaned += 1
		if cleaned >= limit {
			break
		}
	}
	return cleaned, nil
}

func (s *LocalImageAssetStore) DeleteByObjectKey(objectKey string) error {
	objectKey = strings.TrimSpace(objectKey)
	if s == nil || objectKey == "" {
		return nil
	}
	entries, err := os.ReadDir(filepath.Join(s.root, "meta"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		meta, getErr := s.Get(id)
		if getErr != nil || meta.ObjectKey != objectKey {
			continue
		}
		_ = os.Remove(s.assetPath(meta))
		_ = os.Remove(s.metadataPath(id))
	}
	return nil
}

func (s *LocalImageAssetStore) writeMetadata(meta *LocalImageAssetMetadata) error {
	if meta == nil {
		return ErrLocalImageAssetNotFound
	}
	data, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	dir := filepath.Join(s.root, "meta")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return writeFileAtomic(s.metadataPath(meta.ID), data, 0o600)
}

func (s *LocalImageAssetStore) metadataPath(assetID string) string {
	return filepath.Join(s.root, "meta", assetID+".json")
}

func (s *LocalImageAssetStore) assetPath(meta *LocalImageAssetMetadata) string {
	return filepath.Join(s.root, filepath.FromSlash(meta.FileName))
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
