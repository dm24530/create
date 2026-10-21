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
	// ObjectKey 是对象存储里的完整键，删除作品时用它删对象；不下发给前端。
	ObjectKey string `json:"-"`
	URL       string `json:"url"`
	ThumbURL  string `json:"thumb_url,omitempty"`
	Prompt    string `json:"prompt"`
	Model     string `json:"model"`
	Size      string `json:"size"`
	Format    string `json:"format"`
	// Saved 为真表示用户已把它存进「我的作品」：长期有效。
	Saved     bool  `json:"saved"`
	CreatedAt int64 `json:"created_at"`
	// ExpiresAt 只在临时内容上非 0：到期后由后台清扫连对象一起删。
	ExpiresAt int64 `json:"expires_at"`
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
	// SweepExpired 删掉一批到期未保存的记录，返回它们的对象键。
	SweepExpired(ctx context.Context, batch int) ([]string, error)
	// ObjectKey 返回记录的 object_key；记录不存在时返回 ErrStudioWorkNotFound。
	ObjectKey(ctx context.Context, userID int64, id string) (string, error)
	UpdateThumbURL(ctx context.Context, userID int64, id, thumbURL string) error
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
	// FetchImageURL 在服务端下载上游图片，避免浏览器跨域失败导致无法转存。
	FetchImageURL(ctx context.Context, rawURL string) ([]byte, string, error)
}

type ImageStudioGalleryService struct {
	store   ImageStudioGalleryStore
	storage ImageStudioImageSaver
	thumbMu sync.Mutex
	thumbs  map[string]thumbnailCacheEntry
}

func NewImageStudioGalleryService(store ImageStudioGalleryStore, storage ImageStudioImageSaver) *ImageStudioGalleryService {
	return &ImageStudioGalleryService{
		store:   store,
		storage: storage,
		thumbs:  make(map[string]thumbnailCacheEntry),
	}
}

// ProvideImageStudioGalleryService 是 wire 用的版本：构造服务并启动临时作品的过期清扫，
// 和其它后台循环一样在依赖注入阶段触发。单元测试直接用 New...，不会起 goroutine。
func ProvideImageStudioGalleryService(
	store ImageStudioGalleryStore,
	storage ImageStudioImageSaver,
) *ImageStudioGalleryService {
	svc := NewImageStudioGalleryService(store, storage)
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
	// 配额只约束"存到我的作品"的条目：临时内容到期会被清扫，不占 100 的额度。
	if saved && count >= resolveStudioQuota(s.storage) {
		return nil, ErrImageStudioGalleryQuotaExceeded
	}

	// 对象键只用随机 id，不带用户 ID，避免公开访问域名暴露用户身份。
	key := id + extensionForContentType(contentType)
	url, objectKey, err := s.storage.SaveImageWithKey(ctx, key, contentType, data)
	if err != nil {
		return nil, err
	}
	thumbURL := ""
	thumbObjectKey := ""
	if thumb, thumbErr := buildThumbnail(data, 360); thumbErr != nil {
		logger.L().Warn("studio_work.thumbnail_build_failed", zap.String("work_id", id), zap.Error(thumbErr))
	} else if thumbURL, thumbObjectKey, thumbErr = s.storage.SaveImageWithKey(
		ctx,
		"thumbs/"+id+".jpg",
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

	now := time.Now().UTC()
	expiresAt := int64(0)
	if !saved {
		expiresAt = now.Add(s.tempRetention()).Unix()
	}
	entry := &ImageStudioGalleryEntry{
		ID:     id,
		UserID: userID,
		// 存"最终键"（可能带 images/ 之类的前缀），而不是本地拼的那个短键。
		ObjectKey: objectKey,
		URL:       url,
		ThumbURL:  thumbURL,
		Prompt:    strings.TrimSpace(prompt),
		Model:     strings.TrimSpace(model),
		Size:      strings.TrimSpace(size),
		Format:    strings.TrimSpace(format),
		Saved:     saved,
		CreatedAt: now.Unix(),
		ExpiresAt: expiresAt,
	}
	if err := s.store.Save(ctx, entry, resolveStudioQuota(s.storage)); err != nil {
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
) (*ImageStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || strings.TrimSpace(rawURL) == "" {
		return nil, ErrImageStudioGalleryUnavailable
	}
	data, contentType, err := s.storage.FetchImageURL(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	return s.Save(ctx, userID, prompt, model, size, format, contentType, data, saved)
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
	if entries == nil {
		entries = []*ImageStudioGalleryEntry{}
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
	data, contentType, err := s.storage.FetchImageURL(ctx, entry.URL)
	if err != nil {
		return nil, nil, "", err
	}
	return entry, data, contentType, nil
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
		maxEdge = 360
	}
	if maxEdge > 1024 {
		maxEdge = 1024
	}
	cacheKey := id + ":" + strconv.Itoa(maxEdge)
	now := time.Now()
	s.thumbMu.Lock()
	if cached, ok := s.thumbs[cacheKey]; ok && cached.expiresAt.After(now) {
		data := append([]byte(nil), cached.data...)
		s.thumbMu.Unlock()
		return data, nil
	}
	s.thumbMu.Unlock()

	_, data, _, err := s.ReadImage(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	thumb, err := buildThumbnail(data, maxEdge)
	if err != nil {
		return nil, err
	}
	// Backfill old rows once: after this, list responses point straight at the
	// CDN thumbnail and never hit the application server again.
	if thumbURL, thumbKey, saveErr := s.storage.SaveImageWithKey(
		ctx,
		"thumbs/"+id+".jpg",
		"image/jpeg",
		thumb,
	); saveErr != nil {
		logger.L().Warn("studio_work.thumbnail_backfill_upload_failed", zap.String("work_id", id), zap.Error(saveErr))
	} else if updateErr := s.store.UpdateThumbURL(ctx, userID, id, thumbURL); updateErr != nil {
		logger.L().Warn("studio_work.thumbnail_backfill_update_failed", zap.String("work_id", id), zap.Error(updateErr))
		if thumbKey != "" {
			_ = s.storage.DeleteObject(ctx, thumbKey)
		}
	}
	s.thumbMu.Lock()
	if len(s.thumbs) > 512 {
		s.thumbs = make(map[string]thumbnailCacheEntry)
	}
	s.thumbs[cacheKey] = thumbnailCacheEntry{data: append([]byte(nil), thumb...), expiresAt: now.Add(24 * time.Hour)}
	s.thumbMu.Unlock()
	return thumb, nil
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
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 78}); err != nil {
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
	return nil
}

// SweepExpired 清扫到期未保存的内容：先删记录（store 返回对象键），再删桶里的文件。
// 图片和视频共用一张表，所以这一个方法就能把两类都清掉。
func (s *ImageStudioGalleryService) SweepExpired(ctx context.Context, batch int) (int, error) {
	if s == nil || s.store == nil {
		return 0, nil
	}
	keys, err := s.store.SweepExpired(ctx, batch)
	if err != nil {
		return 0, err
	}
	for _, key := range keys {
		if strings.TrimSpace(key) == "" || s.storage == nil {
			continue
		}
		if err := s.storage.DeleteObject(ctx, key); err != nil && !isStorageNotConfigured(err) {
			// 对象没删掉不影响记录已经清掉；留个日志便于人工兜底。
			logger.L().Warn("studio_work.sweep_object_delete_failed",
				zap.String("object_key", key), zap.Error(err))
		}
	}
	return len(keys), nil
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
