package service

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	_ "image/png"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/google/uuid"
	"go.uber.org/zap"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	ImageStudioGalleryTTL = 7 * 24 * time.Hour
	// StudioWorksQuotaPerUser 是每个用户的作品总配额：图片与视频**共用**这一份，
	// 不是各自 100。要改成按类型分别计数，只需让 store.Count 带上 kind 条件。
	StudioWorksQuotaPerUser = 100
)

// ErrStudioWorkNotFound 表示这条作品不存在，或者不属于当前用户。
var ErrStudioWorkNotFound = infraerrors.New(
	http.StatusNotFound,
	"STUDIO_WORK_NOT_FOUND",
	"work not found",
)

var ErrStudioWorkAlreadyExists = errors.New("studio work already exists")

var ErrImageStudioGalleryUnavailable = infraerrors.New(
	http.StatusServiceUnavailable,
	"IMAGE_STUDIO_GALLERY_UNAVAILABLE",
	"image studio gallery storage is unavailable",
)

var ErrImageStudioGalleryQuotaExceeded = infraerrors.New(
	http.StatusTooManyRequests,
	"IMAGE_STUDIO_GALLERY_QUOTA_EXCEEDED",
	"image studio gallery item limit reached",
)

type ImageStudioGalleryEntry struct {
	ID     string `json:"id"`
	UserID int64  `json:"-"`
	// SourceID is stable for one generated image and makes gallery retries idempotent.
	SourceID string `json:"source_id,omitempty"`
	// ObjectKey 是对象存储里的完整键，删除作品时用它删对象；不下发给前端。
	ObjectKey string `json:"-"`
	URL       string `json:"url"`
	ThumbURL  string `json:"thumb_url,omitempty"`
	// LocalAssetID identifies a local original internally only.
	LocalAssetID string `json:"-"`
	// LocalAssetPending keeps signed object URLs hidden until the background upload finishes.
	LocalAssetPending bool `json:"-"`
	// ThumbObjectKey is private but lets List refresh signed thumbnail URLs.
	ThumbObjectKey string `json:"-"`
	Prompt         string `json:"prompt"`
	Model          string `json:"model"`
	Size           string `json:"size"`
	Format         string `json:"format"`
	// Saved 为真表示用户已把它存进「我的作品」：长期有效。
	Saved     bool  `json:"saved"`
	CreatedAt int64 `json:"created_at"`
	SortOrder int64 `json:"sort_order,omitempty"`
	// DurationMs is the wall-clock image generation time when known.
	DurationMs int `json:"duration_ms,omitempty"`
	// ExpiresAt 只在临时内容上非 0：到期后由后台清扫连对象一起删。
	ExpiresAt int64 `json:"expires_at"`
}

type ImageStudioGallerySaveOptions struct {
	DurationMs  int
	CreatedAt   int64
	SortOrder   int64
	ContentType string
	SourceID    string
}

type ExpiredStudioWork struct {
	ID             string
	ObjectKey      string
	ThumbObjectKey string
}

type ImageStudioGalleryStore interface {
	// Save 落库前会在同一事务里核对配额；超额返回 ErrStudioWorksQuotaExceeded。
	// 计数与插入必须原子，否则并发提交能越过上限。
	Save(ctx context.Context, entry *ImageStudioGalleryEntry, quota int64) error
	// List 的 saved 为 nil 时同时返回临时与已保存的条目。
	List(ctx context.Context, userID int64, limit int, saved *bool) ([]*ImageStudioGalleryEntry, error)
	Count(ctx context.Context, userID int64) (int64, error)
	// Pin 把临时作品转成长期保存（计入配额）。
	Pin(ctx context.Context, userID int64, id string, quota int64) error
	// Unpin 把已保存作品转回临时内容，并写入新的过期时间。
	Unpin(ctx context.Context, userID int64, id string, expiresAt int64) error
	// ListExpired returns a batch of expired temporary works without deleting
	// them, so callers can remove storage objects before dropping the rows.
	ListExpired(ctx context.Context, batch int) ([]ExpiredStudioWork, error)
	DeleteExpiredByIDs(ctx context.Context, ids []string) (int, error)
	ReconcileTemporaryExpiry(ctx context.Context, imageRetentionSeconds, videoRetentionSeconds int64) (int64, error)
	// ObjectKey 返回记录的 object_key；记录不存在时返回 ErrStudioWorkNotFound。
	ObjectKey(ctx context.Context, userID int64, id string) (string, error)
	FindBySourceID(ctx context.Context, userID int64, sourceID string) (*ImageStudioGalleryEntry, error)
	UpdateThumb(ctx context.Context, userID int64, id, thumbURL, thumbObjectKey string) error
	Delete(ctx context.Context, userID int64, id string) error
}

type ImageStudioImageSaver interface {
	// SaveImageWithKey 返回访问 URL 和最终的对象键（含配置的 Key 前缀）。
	// 记录里必须存后者，删除作品时才能定位到同一个对象。
	SaveImageWithKey(ctx context.Context, key, contentType string, data []byte) (string, string, error)
	// DeleteObject 删除对象存储里的文件；未配置存储时返回错误，调用方据此保留记录。
	DeleteObject(ctx context.Context, key string) error
	// StudioWorksQuota 是后台配置的作品配额上限（图片 + 视频合计）。
	StudioWorksQuota() int
	GalleryRetention() time.Duration
	VideoRetention() time.Duration
	// FetchImageURL 在服务端下载上游图片，避免浏览器跨域失败导致无法转存。
	FetchImageURL(ctx context.Context, rawURL string) ([]byte, string, error)
}

type ImageStudioObjectURLResolver interface {
	PresignImageObject(ctx context.Context, objectKey string) (string, error)
}

type ImageStudioObjectDownloadURLResolver interface {
	PresignImageObjectDownload(ctx context.Context, objectKey, filename string) (string, error)
}

type ImageStudioObjectURLBatchResolver interface {
	PresignImageObjects(ctx context.Context, objectKeys []string) (map[string]string, error)
}

type ImageStudioGalleryService struct {
	store       ImageStudioGalleryStore
	storage     ImageStudioImageSaver
	localAssets *LocalImageAssetStore
	identities  UserStorageIdentityResolver
	thumbMu     sync.Mutex
	thumbs      map[string]thumbnailCacheEntry
}

func NewImageStudioGalleryService(store ImageStudioGalleryStore, storage ImageStudioImageSaver) *ImageStudioGalleryService {
	return &ImageStudioGalleryService{
		store:   store,
		storage: storage,
		thumbs:  make(map[string]thumbnailCacheEntry),
	}
}

func (s *ImageStudioGalleryService) SetLocalAssetStore(store *LocalImageAssetStore) {
	if s == nil {
		return
	}
	s.localAssets = store
}

func (s *ImageStudioGalleryService) SetUserStorageIdentityResolver(identities UserStorageIdentityResolver) {
	if s == nil {
		return
	}
	s.identities = identities
}

// ProvideImageStudioGalleryService 是 wire 用的版本：构造服务并启动临时作品的过期清扫，
// 和其它后台循环一样在依赖注入阶段触发。单元测试直接用 New...，不会起 goroutine。
func ProvideImageStudioGalleryService(
	store ImageStudioGalleryStore,
	storage ImageStudioImageSaver,
	identities UserStorageIdentityResolver,
	localAssets *LocalImageAssetStore,
) *ImageStudioGalleryService {
	svc := NewImageStudioGalleryService(store, storage)
	svc.SetUserStorageIdentityResolver(identities)
	svc.SetLocalAssetStore(localAssets)
	svc.StartExpirySweeper(context.Background(), studioWorksSweepInterval)
	return svc
}

// tempRetention 是"没存进我的作品"的临时内容保留时长，沿用后台的「图片工作台保留天数」。
func (s *ImageStudioGalleryService) tempRetention() time.Duration {
	if s != nil && s.storage != nil {
		if d := s.storage.GalleryRetention(); d > 0 {
			return d
		}
	}
	return ImageStudioGalleryTTL
}

func (s *ImageStudioGalleryService) videoTempRetention() time.Duration {
	if s != nil && s.storage != nil {
		if d := s.storage.VideoRetention(); d > 0 {
			return d
		}
	}
	return ImageStudioGalleryTTL
}

func (s *ImageStudioGalleryService) Save(
	ctx context.Context,
	userID int64,
	prompt string,
	model string,
	size string,
	format string,
	contentType string,
	data []byte,
	saved bool,
	options ...ImageStudioGallerySaveOptions,
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || len(data) == 0 {
		return nil, ErrImageStudioGalleryUnavailable
	}

	id := strings.ReplaceAll(uuid.NewString(), "-", "")
	sourceID := ""
	if len(options) > 0 {
		sourceID = normalizeStudioSourceID(options[0].SourceID)
	}
	if sourceID != "" {
		existing, findErr := s.store.FindBySourceID(ctx, userID, sourceID)
		switch {
		case findErr == nil && existing != nil:
			if existing.ExpiresAt > 0 && existing.ExpiresAt <= time.Now().UTC().Unix() {
				s.cleanupExpiredImageEntry(ctx, existing)
			} else {
				return s.saveExistingImageEntry(ctx, userID, existing, saved)
			}
		case findErr != nil && !errors.Is(findErr, ErrStudioWorkNotFound):
			return nil, findErr
		}
	}
	contentType = strings.TrimSpace(strings.ToLower(contentType))
	if !strings.HasPrefix(contentType, "image/") {
		contentType = detectImageContentType(data)
	}
	data, contentType, err := TranscodeImageOutput(data, contentType, format)
	if err != nil {
		return nil, err
	}
	count, err := s.store.Count(ctx, userID)
	if err != nil {
		return nil, err
	}
	// 配额只约束"存到我的作品"的条目：临时内容到期会被清扫，不占 100 的额度。
	if saved && count >= resolveStudioQuota(s.storage) {
		return nil, ErrImageStudioGalleryQuotaExceeded
	}

	storageKey, err := s.userStorageKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	userPrefix := storageKey
	key := path.Join(userPrefix, id+extensionForContentType(contentType))
	url, objectKey, err := s.storage.SaveImageWithKey(ctx, key, contentType, data)
	if err != nil {
		return nil, err
	}
	thumbURL := ""
	thumbObjectKey := ""
	if thumb, thumbErr := buildThumbnail(data, 720); thumbErr != nil {
		logger.L().Warn("studio_work.thumbnail_build_failed", zap.String("work_id", id), zap.Error(thumbErr))
	} else if thumbURL, thumbObjectKey, thumbErr = s.storage.SaveImageWithKey(
		ctx,
		path.Join(userPrefix, "thumbs", id+".jpg"),
		"image/jpeg",
		thumb,
	); thumbErr != nil {
		logger.L().Warn("studio_work.thumbnail_upload_failed", zap.String("work_id", id), zap.Error(thumbErr))
	}
	cleanupObjects := func() {
		for _, objectKey := range []string{objectKey, thumbObjectKey} {
			if objectKey == "" {
				continue
			}
			if delErr := s.storage.DeleteObject(ctx, objectKey); delErr != nil {
				logger.L().Warn("studio_work.rollback_delete_failed",
					zap.String("object_key", objectKey), zap.Error(delErr))
			}
		}
	}

	serverNow := time.Now().UTC()
	createdAt := serverNow
	generationDurationMs := 0
	sortOrder := int64(0)
	if len(options) > 0 {
		generationDurationMs = max(options[0].DurationMs, 0)
		if options[0].SortOrder > 0 {
			sortOrder = options[0].SortOrder
		}
		if options[0].CreatedAt > 0 {
			candidate := time.Unix(options[0].CreatedAt, 0).UTC()
			// 客户端时间只用于展示；限制异常时钟值，过期时间始终由服务端决定。
			if !candidate.After(serverNow.Add(5*time.Minute)) &&
				!candidate.Before(serverNow.Add(-30*24*time.Hour)) {
				createdAt = candidate
			}
		}
	}
	expiresAt := int64(0)
	if !saved {
		expiresAt = serverNow.Add(s.tempRetention()).Unix()
	}
	if sortOrder <= 0 {
		sortOrder = createdAt.Unix() * 1_000_000
	}
	entry := &ImageStudioGalleryEntry{
		ID:       id,
		UserID:   userID,
		SourceID: sourceID,
		// 存"最终键"（可能带 images/ 之类的前缀），而不是本地拼的那个短键。
		ObjectKey:      objectKey,
		URL:            url,
		ThumbURL:       thumbURL,
		ThumbObjectKey: thumbObjectKey,
		Prompt:         strings.TrimSpace(prompt),
		Model:          strings.TrimSpace(model),
		Size:           strings.TrimSpace(size),
		Format:         ImageOutputFormatFromContentType(contentType),
		Saved:          saved,
		CreatedAt:      createdAt.Unix(),
		SortOrder:      sortOrder,
		DurationMs:     generationDurationMs,
		ExpiresAt:      expiresAt,
	}
	if err := s.store.Save(ctx, entry, resolveStudioQuota(s.storage)); err != nil {
		if errors.Is(err, ErrStudioWorkAlreadyExists) && sourceID != "" {
			cleanupObjects()
			existing, findErr := s.store.FindBySourceID(ctx, userID, sourceID)
			if findErr != nil {
				return nil, findErr
			}
			return s.saveExistingImageEntry(ctx, userID, existing, saved)
		}
		if errors.Is(err, ErrStudioWorksQuotaExceeded) {
			// 并发下抢先失败：刚上传的对象要撤掉，不然就成了没人认领的孤儿。
			cleanupObjects()
			return nil, ErrImageStudioGalleryQuotaExceeded
		}
		if errors.Is(err, ErrStudioWorksTempLimitExceeded) {
			cleanupObjects()
			return nil, ErrStudioWorksTempLimitExceeded
		}
		cleanupObjects()
		return nil, err
	}
	return entry, nil
}

func normalizeStudioSourceID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 160 {
		return value[:160]
	}
	return value
}

func (s *ImageStudioGalleryService) saveExistingImageEntry(
	ctx context.Context,
	userID int64,
	entry *ImageStudioGalleryEntry,
	saved bool,
) (*ImageStudioGalleryEntry, error) {
	if entry == nil {
		return nil, ErrStudioWorkNotFound
	}
	if saved && !entry.Saved {
		if err := s.store.Pin(ctx, userID, entry.ID, resolveStudioQuota(s.storage)); err != nil {
			if errors.Is(err, ErrStudioWorksQuotaExceeded) {
				return nil, ErrImageStudioGalleryQuotaExceeded
			}
			return nil, err
		}
		entry.Saved = true
		entry.ExpiresAt = 0
	}
	if entry.ExpiresAt == 0 {
		s.updateLocalAssetExpiry(ctx, entry.URL, 0)
	}
	s.hidePendingLocalAssetURL(entry)
	return entry, nil
}

func (s *ImageStudioGalleryService) cleanupExpiredImageEntry(
	ctx context.Context,
	entry *ImageStudioGalleryEntry,
) {
	if entry == nil {
		return
	}
	for _, objectKey := range []string{entry.ObjectKey, entry.ThumbObjectKey} {
		if objectKey == "" {
			continue
		}
		if err := s.storage.DeleteObject(ctx, objectKey); err != nil {
			logger.L().Warn("studio_work.expired_object_delete_failed",
				zap.String("object_key", objectKey), zap.Error(err))
		}
	}
	if err := s.store.Delete(ctx, entry.UserID, entry.ID); err != nil && !errors.Is(err, ErrStudioWorkNotFound) {
		logger.L().Warn("studio_work.expired_row_delete_failed",
			zap.String("work_id", entry.ID), zap.Error(err))
	}
}

func (s *ImageStudioGalleryService) userStorageKey(ctx context.Context, userID int64) (string, error) {
	if s != nil && s.identities != nil {
		return s.identities.StorageKey(ctx, userID)
	}
	return path.Join("users", strconv.FormatInt(userID, 10)), nil
}

// SaveExistingObject turns an object already persisted by the image task
// pipeline into a studio work without downloading or uploading the image again.
func (s *ImageStudioGalleryService) SaveExistingObject(
	ctx context.Context,
	userID int64,
	objectKey string,
	url string,
	prompt string,
	model string,
	size string,
	format string,
	saved bool,
	options ...ImageStudioGallerySaveOptions,
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || strings.TrimSpace(objectKey) == "" {
		return nil, ErrImageStudioGalleryUnavailable
	}
	sourceID := ""
	if len(options) > 0 {
		sourceID = normalizeStudioSourceID(options[0].SourceID)
	}
	if sourceID != "" {
		existing, findErr := s.store.FindBySourceID(ctx, userID, sourceID)
		switch {
		case findErr == nil && existing != nil:
			if existing.ExpiresAt > 0 && existing.ExpiresAt <= time.Now().UTC().Unix() {
				s.cleanupExpiredImageEntry(ctx, existing)
			} else {
				return s.saveExistingImageEntry(ctx, userID, existing, saved)
			}
		case findErr != nil && !errors.Is(findErr, ErrStudioWorkNotFound):
			return nil, findErr
		}
	}
	count, err := s.store.Count(ctx, userID)
	if err != nil {
		return nil, err
	}
	if saved && count >= resolveStudioQuota(s.storage) {
		return nil, ErrImageStudioGalleryQuotaExceeded
	}

	serverNow := time.Now().UTC()
	createdAt := serverNow
	durationMs := 0
	sortOrder := int64(0)
	if len(options) > 0 {
		durationMs = max(options[0].DurationMs, 0)
		if options[0].SortOrder > 0 {
			sortOrder = options[0].SortOrder
		}
		if options[0].CreatedAt > 0 {
			candidate := time.Unix(options[0].CreatedAt, 0).UTC()
			if !candidate.After(serverNow.Add(5*time.Minute)) &&
				!candidate.Before(serverNow.Add(-30*24*time.Hour)) {
				createdAt = candidate
			}
		}
	}
	expiresAt := int64(0)
	if !saved {
		expiresAt = serverNow.Add(s.tempRetention()).Unix()
	}
	if sortOrder <= 0 {
		sortOrder = createdAt.Unix() * 1_000_000
	}
	entry := &ImageStudioGalleryEntry{
		ID:         strings.ReplaceAll(uuid.NewString(), "-", ""),
		UserID:     userID,
		SourceID:   sourceID,
		ObjectKey:  strings.TrimSpace(objectKey),
		URL:        strings.TrimSpace(url),
		Prompt:     strings.TrimSpace(prompt),
		Model:      strings.TrimSpace(model),
		Size:       strings.TrimSpace(size),
		Format:     imageStudioExistingObjectFormat(objectKey, format, options),
		Saved:      saved,
		CreatedAt:  createdAt.Unix(),
		SortOrder:  sortOrder,
		DurationMs: durationMs,
		ExpiresAt:  expiresAt,
	}
	if err := s.store.Save(ctx, entry, resolveStudioQuota(s.storage)); err != nil {
		if errors.Is(err, ErrStudioWorkAlreadyExists) && sourceID != "" {
			existing, findErr := s.store.FindBySourceID(ctx, userID, sourceID)
			if findErr != nil {
				return nil, findErr
			}
			return s.saveExistingImageEntry(ctx, userID, existing, saved)
		}
		return nil, err
	}
	s.updateLocalAssetExpiry(ctx, entry.URL, entry.ExpiresAt)
	s.hidePendingLocalAssetURL(entry)
	return entry, nil
}

func imageStudioExistingObjectFormat(
	objectKey string,
	requestedFormat string,
	options []ImageStudioGallerySaveOptions,
) string {
	if len(options) > 0 {
		if format := ImageOutputFormatFromContentType(options[0].ContentType); format != "" {
			return format
		}
	}
	if format := ImageOutputFormatFromObjectKey(objectKey); format != "" {
		return format
	}
	if format := NormalizeImageOutputFormat(requestedFormat); format != "" {
		return format
	}
	return strings.TrimSpace(requestedFormat)
}

// SaveFromURL 由服务端下载上游图片并转存到对象存储。
// 上游返回的 URL 常常不允许浏览器跨域读取、且大多是短时效签名链接，
// 由服务端抓取可以避开这两点，保证图库里存的是自己的长期地址。
func (s *ImageStudioGalleryService) SaveFromURL(
	ctx context.Context,
	userID int64,
	prompt string,
	model string,
	size string,
	format string,
	rawURL string,
	saved bool,
	options ...ImageStudioGallerySaveOptions,
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || strings.TrimSpace(rawURL) == "" {
		return nil, ErrImageStudioGalleryUnavailable
	}
	data, contentType, err := s.storage.FetchImageURL(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	return s.Save(ctx, userID, prompt, model, size, format, contentType, data, saved, options...)
}

// List 列出作品。saved 为 nil 时临时与已保存都返回（图片工作台需要同屏展示）。
func (s *ImageStudioGalleryService) List(
	ctx context.Context, userID int64, limit int, saved *bool,
) ([]*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || userID <= 0 {
		return []*ImageStudioGalleryEntry{}, nil
	}
	// limit <= 0 表示"用配额决定的默认条数"；上限同样跟着配额走。
	maxItems := studioWorksListLimit(s.storage)
	if limit <= 0 || limit > maxItems {
		limit = maxItems
	}
	entries, err := s.store.List(ctx, userID, limit, saved)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		s.hidePendingLocalAssetURL(entry)
	}
	visible := make([]*ImageStudioGalleryEntry, 0, len(entries))
	for _, entry := range entries {
		// Reference images uploaded by older video-studio clients were written
		// through the image gallery endpoint. They are not image generations,
		// so keep the already-expiring rows out of the image workbench.
		if entry != nil &&
			!entry.Saved &&
			strings.TrimSpace(entry.Size) == "reference" &&
			strings.TrimSpace(entry.Prompt) == "Video reference image" {
			continue
		}
		visible = append(visible, entry)
	}
	entries = visible
	if batchResolver, ok := s.storage.(ImageStudioObjectURLBatchResolver); ok {
		keys := make([]string, 0, len(entries)*2)
		seen := make(map[string]struct{}, len(entries)*2)
		for _, entry := range entries {
			if entry == nil {
				continue
			}
			if entry.LocalAssetPending {
				continue
			}
			if s.localAssets != nil &&
				s.localAssets.IsAssetURL(entry.URL) &&
				!s.localAssets.IsUploadedURL(entry.URL) {
				continue
			}
			addObjectKey := func(key string) {
				key = strings.TrimSpace(key)
				if key == "" {
					return
				}
				if _, exists := seen[key]; exists {
					return
				}
				seen[key] = struct{}{}
				keys = append(keys, key)
			}
			addObjectKey(entry.ObjectKey)
			addObjectKey(entry.ThumbObjectKey)
		}
		if len(keys) > 0 {
			resolved, resolveErr := batchResolver.PresignImageObjects(ctx, keys)
			if resolveErr != nil {
				return entries, nil
			}
			for _, entry := range entries {
				if entry == nil {
					continue
				}
				if entry.LocalAssetPending {
					continue
				}
				if s.localAssets != nil &&
					s.localAssets.IsAssetURL(entry.URL) &&
					!s.localAssets.IsUploadedURL(entry.URL) {
					continue
				}
				objectKey := strings.TrimSpace(entry.ObjectKey)
				if resolvedURL := resolved[objectKey]; resolvedURL != "" {
					entry.URL = resolvedURL
				}
				if thumbKey := strings.TrimSpace(entry.ThumbObjectKey); thumbKey != "" {
					if resolvedURL := resolved[thumbKey]; resolvedURL != "" {
						entry.ThumbURL = resolvedURL
					}
				}
			}
		}
		// 已经是批量解析器时不要退回逐条解析，否则配置异常时会放大成 2N 次读取。
		return entries, nil
	}
	if resolver, ok := s.storage.(ImageStudioObjectURLResolver); ok {
		for _, entry := range entries {
			if entry == nil {
				continue
			}
			if entry.LocalAssetPending {
				continue
			}
			if s.localAssets != nil &&
				s.localAssets.IsAssetURL(entry.URL) &&
				!s.localAssets.IsUploadedURL(entry.URL) {
				continue
			}
			objectKey := strings.TrimSpace(entry.ObjectKey)
			if objectKey != "" {
				if resolved, resolveErr := resolver.PresignImageObject(ctx, objectKey); resolveErr == nil && resolved != "" {
					entry.URL = resolved
				}
			}
			if thumbKey := strings.TrimSpace(entry.ThumbObjectKey); thumbKey != "" {
				if resolved, resolveErr := resolver.PresignImageObject(ctx, thumbKey); resolveErr == nil && resolved != "" {
					entry.ThumbURL = resolved
				}
			}
		}
	}
	return entries, nil
}

// Get returns one owned gallery entry. The list is already bounded by the
// per-user quota, so filtering here keeps the store contract small.
func (s *ImageStudioGalleryService) Get(ctx context.Context, userID int64, id string) (*ImageStudioGalleryEntry, error) {
	items, err := s.List(ctx, userID, 0, nil)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item != nil && item.ID == id {
			return item, nil
		}
	}
	return nil, ErrStudioWorkNotFound
}

func (s *ImageStudioGalleryService) rawEntry(
	ctx context.Context,
	userID int64,
	id string,
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil {
		return nil, ErrImageStudioGalleryUnavailable
	}
	items, err := s.store.List(ctx, userID, studioWorksListLimit(s.storage), nil)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item != nil && item.ID == id {
			return item, nil
		}
	}
	return nil, ErrStudioWorkNotFound
}

// ReadImage fetches the stored object through the server so browser downloads
// are not blocked by the object store's missing CORS headers.
func (s *ImageStudioGalleryService) ReadImage(ctx context.Context, userID int64, id string) (*ImageStudioGalleryEntry, []byte, string, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 {
		return nil, nil, "", ErrImageStudioGalleryUnavailable
	}
	entry, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, nil, "", err
	}
	if entry.LocalAssetPending && entry.LocalAssetID != "" && s.localAssets != nil {
		meta, data, readErr := s.localAssets.Read(entry.LocalAssetID)
		if readErr != nil {
			return nil, nil, "", readErr
		}
		return entry, data, meta.ContentType, nil
	}
	data, contentType, err := s.fetchEntryImage(ctx, entry, entry.ObjectKey, entry.URL)
	if err != nil {
		return nil, nil, "", err
	}
	return entry, data, contentType, nil
}

func (s *ImageStudioGalleryService) DownloadURL(
	ctx context.Context,
	userID int64,
	id string,
	filename string,
) (*ImageStudioGalleryEntry, string, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 {
		return nil, "", ErrImageStudioGalleryUnavailable
	}
	entry, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, "", err
	}
	if entry.LocalAssetPending ||
		(s.localAssets != nil &&
			s.localAssets.IsAssetURL(entry.URL) &&
			!s.localAssets.IsUploadedURL(entry.URL)) {
		return entry, "", ErrImageStudioGalleryUnavailable
	}
	resolver, ok := s.storage.(ImageStudioObjectDownloadURLResolver)
	if !ok {
		return entry, "", ErrImageStudioGalleryUnavailable
	}
	url, err := resolver.PresignImageObjectDownload(ctx, entry.ObjectKey, filename)
	if err != nil || strings.TrimSpace(url) == "" {
		return entry, "", ErrImageStudioGalleryUnavailable
	}
	return entry, url, nil
}

type thumbnailCacheEntry struct {
	data      []byte
	expiresAt time.Time
}

// Thumbnail returns a small JPEG preview while keeping the original object
// untouched for downloads. Results are cached because work cards request the
// same preview repeatedly.
func (s *ImageStudioGalleryService) Thumbnail(ctx context.Context, userID int64, id string, maxEdge int) ([]byte, error) {
	if maxEdge < 64 {
		maxEdge = 720
	}
	if maxEdge > 1024 {
		maxEdge = 1024
	}
	cacheKey := id + ":" + strconv.Itoa(maxEdge)
	entry, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	s.thumbMu.Lock()
	if cached, ok := s.thumbs[cacheKey]; ok && cached.expiresAt.After(now) {
		data := append([]byte(nil), cached.data...)
		s.thumbMu.Unlock()
		return data, nil
	}
	s.thumbMu.Unlock()

	if thumbURL := strings.TrimSpace(entry.ThumbURL); thumbURL != "" {
		data, _, fetchErr := s.fetchEntryImage(ctx, entry, entry.ThumbObjectKey, thumbURL)
		if fetchErr == nil {
			s.cacheThumbnail(cacheKey, data, now)
			return data, nil
		}
		logger.L().Warn("studio_work.thumbnail_fetch_failed", zap.String("work_id", id), zap.Error(fetchErr))
	}
	data, _, err := s.fetchEntryImage(ctx, entry, entry.ObjectKey, entry.URL)
	if err != nil {
		return nil, err
	}
	thumb, err := buildThumbnail(data, maxEdge)
	if err != nil {
		return nil, err
	}
	// Backfill old rows once: after this, list responses point straight at the
	// CDN thumbnail and never hit the application server again.
	userPrefix, keyErr := s.userStorageKey(ctx, userID)
	if keyErr != nil {
		return nil, keyErr
	}
	if thumbURL, thumbKey, saveErr := s.storage.SaveImageWithKey(
		ctx,
		path.Join(userPrefix, "thumbs", id+".jpg"),
		"image/jpeg",
		thumb,
	); saveErr != nil {
		logger.L().Warn("studio_work.thumbnail_backfill_upload_failed", zap.String("work_id", id), zap.Error(saveErr))
	} else if updateErr := s.store.UpdateThumb(ctx, userID, id, thumbURL, thumbKey); updateErr != nil {
		logger.L().Warn("studio_work.thumbnail_backfill_update_failed", zap.String("work_id", id), zap.Error(updateErr))
		if thumbKey != "" {
			_ = s.storage.DeleteObject(ctx, thumbKey)
		}
	}
	s.cacheThumbnail(cacheKey, thumb, now)
	return thumb, nil
}

func (s *ImageStudioGalleryService) fetchEntryImage(
	ctx context.Context,
	entry *ImageStudioGalleryEntry,
	objectKey string,
	rawURL string,
) ([]byte, string, error) {
	if s == nil {
		return nil, "", ErrImageStudioGalleryUnavailable
	}
	if entry != nil && entry.LocalAssetPending && entry.LocalAssetID != "" && s.localAssets != nil {
		meta, data, err := s.localAssets.Read(entry.LocalAssetID)
		if err != nil {
			return nil, "", err
		}
		return data, meta.ContentType, nil
	}
	if s.storage == nil {
		return nil, "", ErrImageStudioGalleryUnavailable
	}
	if entry != nil &&
		s.localAssets != nil &&
		s.localAssets.IsAssetURL(entry.URL) &&
		!s.localAssets.IsUploadedURL(entry.URL) {
		return s.storage.FetchImageURL(ctx, entry.URL)
	}
	objectKey = strings.TrimSpace(objectKey)
	if resolver, ok := s.storage.(ImageStudioObjectURLResolver); ok && objectKey != "" {
		if resolved, err := resolver.PresignImageObject(ctx, objectKey); err == nil && strings.TrimSpace(resolved) != "" {
			rawURL = resolved
		}
	}
	return s.storage.FetchImageURL(ctx, rawURL)
}

func (s *ImageStudioGalleryService) cacheThumbnail(cacheKey string, data []byte, now time.Time) {
	s.thumbMu.Lock()
	defer s.thumbMu.Unlock()
	if len(s.thumbs) > 512 {
		s.thumbs = make(map[string]thumbnailCacheEntry)
	}
	s.thumbs[cacheKey] = thumbnailCacheEntry{data: append([]byte(nil), data...), expiresAt: now.Add(24 * time.Hour)}
}

func buildThumbnail(data []byte, maxEdge int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return nil, errors.New("image has empty bounds")
	}
	scale := float64(maxEdge) / float64(max(width, height))
	if scale > 1 {
		scale = 1
	}
	dstWidth := max(1, int(float64(width)*scale))
	dstHeight := max(1, int(float64(height)*scale))
	dst := image.NewRGBA(image.Rect(0, 0, dstWidth, dstHeight))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, xdraw.Over, nil)

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 88}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// Delete 删除一条作品：先删对象存储里的文件，成功后再删记录。
//
// 顺序是刻意的：反过来的话，删对象失败就会留下一个再也找不到的孤儿文件。
func (s *ImageStudioGalleryService) Delete(ctx context.Context, userID int64, id string) error {
	if s == nil || s.store == nil || userID <= 0 || strings.TrimSpace(id) == "" {
		return ErrImageStudioGalleryUnavailable
	}
	if key, err := s.store.ObjectKey(ctx, userID, strings.TrimSpace(id)); err == nil && s.storage != nil {
		if thumbKey := thumbnailObjectKey(key); thumbKey != "" {
			if err := s.storage.DeleteObject(ctx, thumbKey); err != nil && !isStorageNotConfigured(err) {
				return err
			}
		}
	}
	return deleteStudioWorkByKey(ctx, s.store, s.storage, userID, strings.TrimSpace(id))
}

func thumbnailObjectKey(objectKey string) string {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return ""
	}
	dir := path.Dir(objectKey)
	base := strings.TrimSuffix(path.Base(objectKey), path.Ext(objectKey))
	if dir == "." {
		return path.Join("thumbs", base+".jpg")
	}
	return path.Join(dir, "thumbs", base+".jpg")
}

// Quota 返回该用户作品库的使用量。图片与视频共用同一份配额，所以这里统计的是总数。
func (s *ImageStudioGalleryService) Quota(ctx context.Context, userID int64) (StudioWorksQuota, error) {
	quota := StudioWorksQuota{Limit: int64(StudioWorksQuotaPerUser)}
	if s != nil {
		quota.Limit = resolveStudioQuota(s.storage)
		quota.RetentionSeconds = int64(s.tempRetention().Seconds())
	}
	if s == nil || s.store == nil || userID <= 0 {
		return quota, nil
	}
	used, err := s.store.Count(ctx, userID)
	if err != nil {
		return quota, err
	}
	quota.Used = used
	return quota, nil
}

// Pin 把一条临时作品转成「我的作品」里的长期内容（计入配额）。
func (s *ImageStudioGalleryService) Pin(ctx context.Context, userID int64, id string) error {
	if s == nil || s.store == nil || userID <= 0 || strings.TrimSpace(id) == "" {
		return ErrImageStudioGalleryUnavailable
	}
	if err := s.store.Pin(ctx, userID, strings.TrimSpace(id), resolveStudioQuota(s.storage)); err != nil {
		if errors.Is(err, ErrStudioWorksQuotaExceeded) {
			return ErrImageStudioGalleryQuotaExceeded
		}
		return err
	}
	if entry, err := s.rawEntry(ctx, userID, strings.TrimSpace(id)); err == nil && entry != nil {
		s.updateLocalAssetExpiry(ctx, entry.URL, 0)
	}
	return nil
}

// Unpin 取消保存。取消后从当前时间重新开始临时保留期。
func (s *ImageStudioGalleryService) Unpin(
	ctx context.Context,
	userID int64,
	id string,
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || userID <= 0 || strings.TrimSpace(id) == "" {
		return nil, ErrImageStudioGalleryUnavailable
	}
	entry, err := s.rawEntry(ctx, userID, strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if !entry.Saved {
		return entry, nil
	}
	expiresAt := time.Now().UTC().Add(s.tempRetention()).Unix()
	if err := s.store.Unpin(ctx, userID, entry.ID, expiresAt); err != nil {
		return nil, err
	}
	s.updateLocalAssetExpiry(ctx, entry.URL, expiresAt)
	entry.Saved = false
	entry.ExpiresAt = expiresAt
	s.hidePendingLocalAssetURL(entry)
	return entry, nil
}

func (s *ImageStudioGalleryService) updateLocalAssetExpiry(
	ctx context.Context,
	rawURL string,
	expiresAt int64,
) {
	if s == nil || s.localAssets == nil {
		return
	}
	if err := s.localAssets.SetExpiryByURL(rawURL, expiresAt); err != nil &&
		!errors.Is(err, ErrLocalImageAssetNotFound) {
		logger.L().Warn("studio_work.local_asset_expiry_update_failed",
			zap.String("url", rawURL), zap.Error(err))
	}
}

func (s *ImageStudioGalleryService) hidePendingLocalAssetURL(entry *ImageStudioGalleryEntry) {
	if s == nil || s.localAssets == nil || entry == nil {
		return
	}
	assetID, ok := s.localAssets.AssetIDFromURL(entry.URL)
	if !ok && strings.TrimSpace(entry.LocalAssetID) != "" {
		assetID, ok = strings.TrimSpace(entry.LocalAssetID), true
	}
	if !ok {
		return
	}
	entry.LocalAssetID = assetID
	entry.LocalAssetPending = true
	meta, err := s.localAssets.Get(assetID)
	if errors.Is(err, ErrLocalImageAssetNotFound) {
		// The local cache is deliberately removed after an upload has been
		// confirmed. Fall back to the persisted object key instead of treating
		// the work as permanently pending.
		entry.LocalAssetPending = false
		entry.URL = ""
		entry.ThumbURL = ""
		return
	}
	if err == nil && meta.Uploaded && strings.TrimSpace(meta.RemoteURL) != "" {
		entry.URL = strings.TrimSpace(meta.RemoteURL)
		entry.LocalAssetPending = false
		return
	}
	entry.URL = ""
	entry.ThumbURL = ""
}

// SweepExpired removes expired temporary works. Storage objects are deleted
// before their rows so transient storage failures remain retryable.
func (s *ImageStudioGalleryService) SweepExpired(ctx context.Context, batch int) (int, error) {
	if s == nil || s.store == nil {
		return 0, nil
	}
	items, err := s.store.ListExpired(ctx, batch)
	if err != nil {
		return 0, err
	}
	deletableIDs := make([]string, 0, len(items))
	for _, item := range items {
		if item.ID == "" {
			continue
		}
		failed := false
		for _, key := range []string{item.ObjectKey, item.ThumbObjectKey} {
			key = strings.TrimSpace(key)
			if key == "" || s.storage == nil {
				continue
			}
			if err := s.storage.DeleteObject(ctx, key); err != nil {
				logger.L().Warn("studio_work.sweep_object_delete_failed",
					zap.String("object_key", key), zap.Error(err))
				failed = true
				break
			}
		}
		if !failed {
			deletableIDs = append(deletableIDs, item.ID)
		}
	}
	if len(deletableIDs) == 0 {
		return 0, nil
	}
	deleted, err := s.store.DeleteExpiredByIDs(ctx, deletableIDs)
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

// studioWorksSweepInterval 是临时内容的清扫间隔。启动时先跑一遍，
// 所以重启就能把停机期间到期的内容回收掉。
const studioWorksSweepInterval = 30 * time.Minute

// StartExpirySweeper 起后台循环，定期清掉到期未保存的作品（记录 + 对象）。
// 只在 wire 的 provider 里调用；单元测试仍用 New... 构造，不会有 goroutine。
func (s *ImageStudioGalleryService) StartExpirySweeper(ctx context.Context, interval time.Duration) {
	if s == nil || s.store == nil || interval <= 0 {
		return
	}
	go func() {
		s.sweepExpiredOnce(ctx)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.sweepExpiredOnce(ctx)
			}
		}
	}()
}

func (s *ImageStudioGalleryService) sweepExpiredOnce(ctx context.Context) {
	const batch = 200
	if _, err := s.store.ReconcileTemporaryExpiry(
		ctx,
		int64(s.tempRetention()/time.Second),
		int64(s.videoTempRetention()/time.Second),
	); err != nil {
		logger.L().Warn("studio_work.reconcile_expiry_failed", zap.Error(err))
		return
	}
	total := 0
	for {
		swept, err := s.SweepExpired(ctx, batch)
		if err != nil {
			logger.L().Warn("studio_work.sweep_failed", zap.Error(err))
			return
		}
		total += swept
		if swept < batch {
			break
		}
	}
	if total > 0 {
		logger.L().Info("studio_work.swept_expired", zap.Int("count", total))
	}
}
