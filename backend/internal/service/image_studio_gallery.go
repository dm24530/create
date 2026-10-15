package service

import (
	"context"
	"net/http"
	"strings"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/google/uuid"
)

const (
	ImageStudioGalleryTTL        = 7 * 24 * time.Hour
	imageStudioMaxItems          = 100
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
	ID        string `json:"id"`
	UserID    int64  `json:"-"`
	// ObjectKey 是对象存储里的完整键，删除作品时用它删对象；不下发给前端。
	ObjectKey string `json:"-"`
	URL       string `json:"url"`
	Prompt    string `json:"prompt"`
	Model     string `json:"model"`
	Size      string `json:"size"`
	Format    string `json:"format"`
	CreatedAt int64  `json:"created_at"`
	ExpiresAt int64  `json:"expires_at"`
}

type ImageStudioGalleryStore interface {
	Save(ctx context.Context, entry *ImageStudioGalleryEntry) error
	List(ctx context.Context, userID int64, limit int) ([]*ImageStudioGalleryEntry, error)
	Count(ctx context.Context, userID int64) (int64, error)
	// ObjectKey 返回记录的 object_key；记录不存在时返回 ErrStudioWorkNotFound。
	ObjectKey(ctx context.Context, userID int64, id string) (string, error)
	Delete(ctx context.Context, userID int64, id string) error
}

type ImageStudioImageSaver interface {
	// SaveImageWithKey 返回访问 URL 和最终的对象键（含配置的 Key 前缀）。
	// 记录里必须存后者，删除作品时才能定位到同一个对象。
	SaveImageWithKey(ctx context.Context, key, contentType string, data []byte) (string, string, error)
	// DeleteObject 删除对象存储里的文件；未配置存储时返回错误，调用方据此保留记录。
	DeleteObject(ctx context.Context, key string) error
	GalleryRetention() time.Duration
	// FetchImageURL 在服务端下载上游图片，避免浏览器跨域失败导致无法转存。
	FetchImageURL(ctx context.Context, rawURL string) ([]byte, string, error)
}

type ImageStudioGalleryService struct {
	store   ImageStudioGalleryStore
	storage ImageStudioImageSaver
}

func NewImageStudioGalleryService(store ImageStudioGalleryStore, storage ImageStudioImageSaver) *ImageStudioGalleryService {
	return &ImageStudioGalleryService{store: store, storage: storage}
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
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || len(data) == 0 {
		return nil, ErrImageStudioGalleryUnavailable
	}

	id := strings.ReplaceAll(uuid.NewString(), "-", "")
	contentType = strings.TrimSpace(strings.ToLower(contentType))
	if !strings.HasPrefix(contentType, "image/") {
		contentType = detectImageContentType(data)
	}
	count, err := s.store.Count(ctx, userID)
	if err != nil {
		return nil, err
	}
	if count >= StudioWorksQuotaPerUser {
		return nil, ErrImageStudioGalleryQuotaExceeded
	}

	// 对象键只用随机 id，不带用户 ID，避免公开访问域名暴露用户身份。
	key := id + extensionForContentType(contentType)
	url, objectKey, err := s.storage.SaveImageWithKey(ctx, key, contentType, data)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	entry := &ImageStudioGalleryEntry{
		ID:        id,
		UserID:    userID,
		// 存"最终键"（可能带 images/ 之类的前缀），而不是本地拼的那个短键。
		ObjectKey: objectKey,
		URL:       url,
		Prompt:    strings.TrimSpace(prompt),
		Model:     strings.TrimSpace(model),
		Size:      strings.TrimSpace(size),
		Format:    strings.TrimSpace(format),
		CreatedAt: now.Unix(),
		// 作品记录永久保存，不再有过期时间；保留字段以兼容前端与老数据。
		ExpiresAt: 0,
	}
	if err := s.store.Save(ctx, entry); err != nil {
		return nil, err
	}
	return entry, nil
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
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || strings.TrimSpace(rawURL) == "" {
		return nil, ErrImageStudioGalleryUnavailable
	}
	data, contentType, err := s.storage.FetchImageURL(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	return s.Save(ctx, userID, prompt, model, size, format, contentType, data)
}

func (s *ImageStudioGalleryService) List(ctx context.Context, userID int64, limit int) ([]*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || userID <= 0 {
		return []*ImageStudioGalleryEntry{}, nil
	}
	if limit <= 0 || limit > imageStudioMaxItems {
		limit = imageStudioMaxItems
	}
	entries, err := s.store.List(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []*ImageStudioGalleryEntry{}
	}
	return entries, nil
}

// Delete 删除一条作品：先删对象存储里的文件，成功后再删记录。
//
// 顺序是刻意的：反过来的话，删对象失败就会留下一个再也找不到的孤儿文件。
func (s *ImageStudioGalleryService) Delete(ctx context.Context, userID int64, id string) error {
	if s == nil || s.store == nil || userID <= 0 || strings.TrimSpace(id) == "" {
		return ErrImageStudioGalleryUnavailable
	}
	return deleteStudioWorkByKey(ctx, s.store, s.storage, userID, strings.TrimSpace(id))
}

// Quota 返回该用户作品库的使用量。图片与视频共用同一份配额，所以这里统计的是总数。
func (s *ImageStudioGalleryService) Quota(ctx context.Context, userID int64) (StudioWorksQuota, error) {
	quota := StudioWorksQuota{Limit: StudioWorksQuotaPerUser}
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
