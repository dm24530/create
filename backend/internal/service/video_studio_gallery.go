package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	// videoStoragePrefix 让归档视频与图片共用同一套对象存储配置，只用前缀区分。
	videoStoragePrefix = "videos/"
	// maxVideoArchiveBytes 限制单条视频归档大小：服务器抓取与 base64 上传都按它兜底。
	maxVideoArchiveBytes int64 = 256 << 20
)

var (
	ErrVideoStudioGalleryUnavailable = infraerrors.New(
		http.StatusServiceUnavailable,
		"VIDEO_STUDIO_GALLERY_UNAVAILABLE",
		"video studio gallery storage is unavailable",
	)
	ErrVideoStudioGalleryQuotaExceeded = infraerrors.New(
		http.StatusTooManyRequests,
		"VIDEO_STUDIO_GALLERY_QUOTA_EXCEEDED",
		"video studio gallery item limit reached",
	)
	ErrVideoStudioArchiveTooLarge = infraerrors.New(
		http.StatusRequestEntityTooLarge,
		"VIDEO_STUDIO_ARCHIVE_TOO_LARGE",
		"video exceeds the archive size limit",
	)
	ErrVideoStudioUnsupportedType = infraerrors.New(
		http.StatusUnsupportedMediaType,
		"VIDEO_STUDIO_UNSUPPORTED_TYPE",
		"only video files can be archived",
	)
)

// VideoStudioGalleryEntry 是「我的作品」里的一条视频归档记录。
// 记录存在 Redis（带保留期），文件本身存在对象存储，换浏览器也能看到。
type VideoStudioGalleryEntry struct {
	ID              string `json:"id"`
	UserID          int64  `json:"-"`
	// ObjectKey 是对象存储里的完整键（含 videos/ 前缀），删除作品时用它删对象。
	ObjectKey       string `json:"-"`
	URL             string `json:"url"`
	Prompt          string `json:"prompt"`
	Model           string `json:"model"`
	Format          string `json:"format"`
	DurationSeconds int    `json:"duration_seconds"`
	// Saved 为真表示用户已把它存进「我的作品」：长期有效。
	Saved     bool  `json:"saved"`
	CreatedAt int64 `json:"created_at"`
	// ExpiresAt 只在临时内容上非 0：到期后由后台清扫连对象一起删。
	ExpiresAt int64 `json:"expires_at"`
}

type VideoStudioGalleryStore interface {
	// Save 落库前会在同一事务里核对配额；超额返回 ErrStudioWorksQuotaExceeded。
	Save(ctx context.Context, entry *VideoStudioGalleryEntry, quota int64) error
	// List 的 saved 为 nil 时同时返回临时与已保存的条目。
	List(ctx context.Context, userID int64, limit int, saved *bool) ([]*VideoStudioGalleryEntry, error)
	Count(ctx context.Context, userID int64) (int64, error)
	// Pin 把临时作品转成长期保存（计入配额）。
	Pin(ctx context.Context, userID int64, id string, quota int64) error
	// SweepExpired 删掉一批到期未保存的记录，返回它们的对象键。
	SweepExpired(ctx context.Context, batch int) ([]string, error)
	// ObjectKey 返回记录的 object_key；记录不存在时返回 ErrStudioWorkNotFound。
	ObjectKey(ctx context.Context, userID int64, id string) (string, error)
	Delete(ctx context.Context, userID int64, id string) error
}

// VideoStudioMediaSaver 由对象存储设置服务实现（与图片共用同一份配置）。
type VideoStudioMediaSaver interface {
	SaveVideo(ctx context.Context, key, contentType string, data []byte) (string, error)
	// DeleteObject 删除对象存储里的文件；未配置存储时返回错误，调用方据此保留记录。
	DeleteObject(ctx context.Context, key string) error
	// StudioWorksQuota 是后台配置的作品配额上限（图片 + 视频合计）。
	StudioWorksQuota() int
	FetchVideoURL(ctx context.Context, rawURL string) ([]byte, string, error)
	GalleryRetention() time.Duration
}

type VideoStudioGalleryService struct {
	store   VideoStudioGalleryStore
	storage VideoStudioMediaSaver
}

func NewVideoStudioGalleryService(
	store VideoStudioGalleryStore,
	storage VideoStudioMediaSaver,
) *VideoStudioGalleryService {
	return &VideoStudioGalleryService{store: store, storage: storage}
}

// tempRetention 是"没存进我的作品"的临时视频保留时长，与图片共用同一份保留天数配置。
func (s *VideoStudioGalleryService) tempRetention() time.Duration {
	if s != nil && s.storage != nil {
		if d := s.storage.GalleryRetention(); d > 0 {
			return d
		}
	}
	return ImageStudioGalleryTTL
}

// Save 归档一段视频。contentType 必须是视频类型，大小不超过 maxVideoArchiveBytes。
func (s *VideoStudioGalleryService) Save(
	ctx context.Context,
	userID int64,
	prompt string,
	model string,
	format string,
	durationSeconds int,
	contentType string,
	data []byte,
	saved bool,
) (*VideoStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || len(data) == 0 {
		return nil, ErrVideoStudioGalleryUnavailable
	}
	if int64(len(data)) > maxVideoArchiveBytes {
		return nil, ErrVideoStudioArchiveTooLarge
	}
	contentType = normalizeVideoContentType(contentType, data)
	if contentType == "" {
		return nil, ErrVideoStudioUnsupportedType
	}

	count, err := s.store.Count(ctx, userID)
	if err != nil {
		return nil, err
	}
	// 配额只约束"存到我的作品"的条目：临时内容到期会被清扫，不占 100 的额度。
	if saved && count >= resolveStudioQuota(s.storage) {
		return nil, ErrVideoStudioGalleryQuotaExceeded
	}

	// 对象键同样只用随机 id，避免公开域名暴露用户身份。
	id := strings.ReplaceAll(uuid.NewString(), "-", "")
	key := id + videoExtensionForContentType(contentType)
	url, err := s.storage.SaveVideo(ctx, key, contentType, data)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	expiresAt := int64(0)
	if !saved {
		expiresAt = now.Add(s.tempRetention()).Unix()
	}
	entry := &VideoStudioGalleryEntry{
		ID:              id,
		UserID:          userID,
		ObjectKey:       videoStoragePrefix + key,
		URL:             url,
		Prompt:          strings.TrimSpace(prompt),
		Model:           strings.TrimSpace(model),
		Format:          strings.TrimSpace(format),
		DurationSeconds: durationSeconds,
		Saved:           saved,
		CreatedAt:       now.Unix(),
		ExpiresAt:       expiresAt,
	}
	if err := s.store.Save(ctx, entry, resolveStudioQuota(s.storage)); err != nil {
		if errors.Is(err, ErrStudioWorksQuotaExceeded) {
			// 并发下抢先失败：刚上传的对象要撤掉，不然就成了没人认领的孤儿。
			if entry.ObjectKey != "" {
				if delErr := s.storage.DeleteObject(ctx, entry.ObjectKey); delErr != nil {
					logger.L().Warn("studio_work.rollback_delete_failed",
						zap.String("object_key", entry.ObjectKey), zap.Error(delErr))
				}
			}
			return nil, ErrVideoStudioGalleryQuotaExceeded
		}
		if errors.Is(err, ErrStudioWorksTempLimitExceeded) {
			if entry.ObjectKey != "" {
				if delErr := s.storage.DeleteObject(ctx, entry.ObjectKey); delErr != nil {
					logger.L().Warn("studio_work.rollback_delete_failed",
						zap.String("object_key", entry.ObjectKey), zap.Error(delErr))
				}
			}
			return nil, ErrStudioWorksTempLimitExceeded
		}
		return nil, err
	}
	return entry, nil
}

// SaveFromURL 由服务端抓取视频再转存：上游多为短期签名链接，交给服务端更稳。
func (s *VideoStudioGalleryService) SaveFromURL(
	ctx context.Context,
	userID int64,
	prompt string,
	model string,
	format string,
	durationSeconds int,
	rawURL string,
	saved bool,
) (*VideoStudioGalleryEntry, error) {
	if s == nil || s.store == nil || s.storage == nil || userID <= 0 || strings.TrimSpace(rawURL) == "" {
		return nil, ErrVideoStudioGalleryUnavailable
	}
	data, contentType, err := s.storage.FetchVideoURL(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	return s.Save(ctx, userID, prompt, model, format, durationSeconds, contentType, data, saved)
}

// List 列出作品。saved 为 nil 时临时与已保存都返回。
func (s *VideoStudioGalleryService) List(
	ctx context.Context, userID int64, limit int, saved *bool,
) ([]*VideoStudioGalleryEntry, error) {
	if s == nil || s.store == nil || userID <= 0 {
		return []*VideoStudioGalleryEntry{}, nil
	}
	// limit <= 0 表示"用配额决定的默认条数"；上限同样跟着配额走。
	maxItems := studioWorksListLimit(s.storage)
	if limit <= 0 || limit > maxItems {
		limit = maxItems
	}
	return s.store.List(ctx, userID, limit, saved)
}

// Pin 把一条临时视频转成「我的作品」里的长期内容（计入配额）。
func (s *VideoStudioGalleryService) Pin(ctx context.Context, userID int64, id string) error {
	if s == nil || s.store == nil || userID <= 0 || strings.TrimSpace(id) == "" {
		return ErrVideoStudioGalleryUnavailable
	}
	if err := s.store.Pin(ctx, userID, strings.TrimSpace(id), resolveStudioQuota(s.storage)); err != nil {
		if errors.Is(err, ErrStudioWorksQuotaExceeded) {
			return ErrVideoStudioGalleryQuotaExceeded
		}
		return err
	}
	return nil
}

// Delete 删除一条视频作品：先删对象存储里的文件，成功后再删记录。
// 顺序是为了不留下删不掉也查不到的孤儿对象。
func (s *VideoStudioGalleryService) Delete(ctx context.Context, userID int64, id string) error {
	if s == nil || s.store == nil || userID <= 0 || strings.TrimSpace(id) == "" {
		return ErrVideoStudioGalleryUnavailable
	}
	return deleteStudioWorkByKey(ctx, s.store, s.storage, userID, strings.TrimSpace(id))
}

/* ------------------------------ 对象存储写入 ------------------------------ */

// SaveVideo 把归档视频写到对象存储的 videos/ 前缀下（与图片共用同一份配置）。
func (s *ImageStorageSettingService) SaveVideo(ctx context.Context, key, contentType string, data []byte) (string, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return "", reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return "", ErrImageStorageIncomplete
	}
	if int64(len(data)) > maxVideoArchiveBytes {
		return "", ErrVideoStudioArchiveTooLarge
	}
	key = videoStoragePrefix + strings.TrimLeft(strings.TrimSpace(key), "/")
	if storage, ok := uploader.storage.(ImageStorageWithExpiry); ok {
		return storage.SaveWithExpiry(ctx, key, contentType, data, s.GalleryRetention())
	}
	return uploader.storage.Save(ctx, key, contentType, data)
}

// FetchVideoURL 由服务端抓取上游视频，供归档转存使用。
func (s *ImageStorageSettingService) FetchVideoURL(ctx context.Context, rawURL string) ([]byte, string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if s == nil || rawURL == "" {
		return nil, "", ErrImageStorageIncomplete
	}
	if reason := s.unusableReason(ctx); reason != nil {
		return nil, "", reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil {
		return nil, "", ErrImageStorageIncomplete
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("build video download request: %w", err)
	}
	resp, err := uploader.httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("download video: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, "", fmt.Errorf("download video: unexpected status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxVideoArchiveBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read video body: %w", err)
	}
	if int64(len(data)) > maxVideoArchiveBytes {
		return nil, "", ErrVideoStudioArchiveTooLarge
	}
	declared, _, _ := mime.ParseMediaType(strings.TrimSpace(resp.Header.Get("Content-Type")))
	contentType := normalizeVideoContentType(declared, data)
	if contentType == "" {
		return nil, "", ErrVideoStudioUnsupportedType
	}
	return data, contentType, nil
}

// DecodeVideoDataURL 解析前端上传的 base64 视频（浏览器拿到的内容接口需要密钥，
// 只能由前端取回后上传）。
func DecodeVideoDataURL(dataURL string) ([]byte, string, error) {
	trimmed := strings.TrimSpace(dataURL)
	if trimmed == "" {
		return nil, "", fmt.Errorf("decode video data URL: empty payload")
	}
	mediaType, payload, found := strings.Cut(trimmed, ",")
	if !found || !strings.HasPrefix(strings.ToLower(mediaType), "data:") {
		return nil, "", fmt.Errorf("decode video data URL: malformed data URL")
	}
	if !strings.Contains(strings.ToLower(mediaType), ";base64") {
		return nil, "", fmt.Errorf("decode video data URL: payload is not base64 encoded")
	}
	header := mediaType[len("data:"):]
	// "image/png;base64" 里的 base64 不是合法 mime 参数，必须先把标记切掉。
	declaredHeader := header
	if idx := strings.Index(strings.ToLower(header), ";base64"); idx >= 0 {
		declaredHeader = header[:idx]
	}
	declared, _, err := mime.ParseMediaType(strings.TrimSpace(declaredHeader))
	if err != nil {
		return nil, "", fmt.Errorf("decode video data URL: invalid media type: %w", err)
	}
	data, err := decodeBase64Payload(payload, maxVideoArchiveBytes)
	if err != nil {
		return nil, "", err
	}
	contentType := normalizeVideoContentType(declared, data)
	if contentType == "" {
		return nil, "", ErrVideoStudioUnsupportedType
	}
	return data, contentType, nil
}

func normalizeVideoContentType(declared string, data []byte) string {
	declared = strings.ToLower(strings.TrimSpace(strings.Split(declared, ";")[0]))
	if isVideoContentType(declared) {
		return declared
	}
	detected := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
	if isVideoContentType(detected) {
		return detected
	}
	return ""
}

func isVideoContentType(contentType string) bool {
	switch contentType {
	case "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mpeg":
		return true
	default:
		return false
	}
}

func videoExtensionForContentType(contentType string) string {
	switch contentType {
	case "video/webm":
		return ".webm"
	case "video/quicktime":
		return ".mov"
	case "video/x-matroska":
		return ".mkv"
	default:
		return ".mp4"
	}
}

// decodeBase64Payload 在读满 limit 后立即停下，避免超大请求把内存吃满。
func decodeBase64Payload(payload string, limit int64) ([]byte, error) {
	if limit <= 0 {
		limit = maxVideoArchiveBytes
	}
	decoder := base64.NewDecoder(base64.StdEncoding, strings.NewReader(payload))
	data, err := io.ReadAll(io.LimitReader(decoder, limit+1))
	if err != nil {
		return nil, fmt.Errorf("decode base64 payload: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, ErrVideoStudioArchiveTooLarge
	}
	return data, nil
}
