package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"go.uber.org/zap"
)

const settingKeyImageStorageConfig = "image_storage_config"
const imageStorageSettingsCacheTTL = 5 * time.Second
const imageStorageUploadPresignTTL = 15 * time.Minute

// ErrImageStorageIncomplete 表示开关已打开但凭证不全，无法启用异步生图。
//
// 用可对外的业务错误而不是裸 error：裸 error 会被响应层折成 500 internal error，
// 前端只看得到"保存失败"，真正的缺项只留在服务端日志里。
var ErrImageStorageIncomplete = infraerrors.New(
	http.StatusServiceUnavailable,
	"IMAGE_STORAGE_INCOMPLETE",
	"image storage credentials are incomplete",
)

// ErrImageStorageDisabled 表示管理员还没有开启异步生图对象存储。
//
// 必须与 ErrImageStorageIncomplete 分开：两者在后台是两种不同的处置动作
// （去打开开关 vs 去补凭证）。历史上两者共用一句"enabled but ... incomplete"
// 的文案，导致"根本没开"也被读成"配错了"，把排查引向错误方向。
var ErrImageStorageDisabled = infraerrors.New(
	http.StatusServiceUnavailable,
	"IMAGE_STORAGE_DISABLED",
	"image storage is not enabled; turn it on in Admin > Settings > Backups",
)

// ImageStorageStatus 描述当前配置的实际生效状态，供后台页面提示"保存了但没生效"。
type ImageStorageStatus struct {
	Ready   bool     `json:"ready"`   // 开关打开且凭证齐全，功能真正可用
	Enabled bool     `json:"enabled"` // 管理员是否打开了开关
	Missing []string `json:"missing"` // 还缺哪些字段：bucket / access_key_id / secret_access_key
}

// ImageStorageFactory 由 repository 层提供，把配置变成一个可用的对象存储实现。
// 与 BackupObjectStoreFactory 同样的注入方式，避免 service 反向依赖 repository。
type ImageStorageFactory func(ctx context.Context, cfg *config.ImageStorageConfig) (ImageStorage, error)

// ImageStorageConnectionChecker verifies that the configured bucket is reachable.
// Implementations that only build a vendor SDK client cannot detect bad
// credentials or a missing bucket, which would make the admin test button lie.
type ImageStorageConnectionChecker interface {
	HeadBucket(ctx context.Context) error
}

// ImageStorageSettings 是后台可编辑的异步生图对象存储配置。
//
// ReuseBackupS3 为真时不保存自己的凭证，直接借用数据库备份已配置的 S3 端点与密钥，
// 只用自己的 Bucket/Prefix 区分对象；这样"数据走 backups/、图片走 images/"无需重复配置。
type ImageStorageSettings struct {
	Enabled       bool `json:"enabled"`
	ReuseBackupS3 bool `json:"reuse_backup_s3"`

	Bucket               string `json:"bucket"` // 留空且复用备份时，沿用备份桶
	Prefix               string `json:"prefix"`
	PublicBaseURL        string `json:"public_base_url"`
	PresignExpiry        int    `json:"presign_expiry_hours"`
	GalleryRetentionDays int    `json:"gallery_retention_days"`
	// StudioWorksQuota 是每个用户的作品配额（图片 + 视频合计），后台可改。
	StudioWorksQuota int   `json:"studio_works_quota"`
	MaxDownloadBytes int64 `json:"max_download_bytes"`

	// 以下仅在 ReuseBackupS3 为假时使用
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key,omitempty"` //nolint:revive // field name follows AWS convention
	ForcePathStyle  bool   `json:"force_path_style"`
}

// ImageStorageSettingService 读写后台设置，并把结果解析成一个可直接使用的 uploader。
//
// 解析结果带缓存：网关每次请求都要判断功能是否开启，不能每次都查库。保存设置时调用
// Invalidate 清缓存，下一次请求即重建客户端——这是"后台开关立即生效、无需重启"的实现。
type ImageStorageSettingService struct {
	settingRepo SettingRepository
	encryptor   SecretEncryptor
	backup      *BackupService
	factory     ImageStorageFactory
	identities  UserStorageIdentityResolver
	localAssets *LocalImageAssetStore
	localOnce   sync.Once
	uploading   sync.Map

	// mirrorCache 记住"远端地址 → 已转存地址"，避免每次请求都重新下载。
	mirrorMu    sync.Mutex
	mirrorCache map[string]mirrorCacheEntry

	// fallback 是 config.yaml 里的配置。后台从未保存过设置时沿用它，
	// 保证升级前已用配置文件开启该功能的部署不被打断。
	fallback config.ImageStorageConfig

	mu               sync.Mutex
	resolved         bool
	resolvedAt       time.Time
	uploader         *ImageResultUploader
	enabled          bool
	galleryRetention time.Duration
	studioQuota      int
	// backupConfigGeneration is the BackupService credential generation used to
	// build the current uploader. Saving backup S3 settings invalidates the image
	// client immediately instead of waiting for the 5-second consistency window.
	backupConfigGeneration uint64
}

func (s *ImageStorageSettingService) SetLocalAssetStore(store *LocalImageAssetStore) {
	if s == nil || store == nil {
		return
	}
	s.localAssets = store
	s.localOnce.Do(func() {
		go s.localAssetUploadLoop()
	})
}

func (s *ImageStorageSettingService) SetUserStorageIdentityResolver(
	identities UserStorageIdentityResolver,
) {
	if s == nil {
		return
	}
	s.identities = identities
}

func (s *ImageStorageSettingService) StorageKeyForUser(ctx context.Context, userID int64) (string, error) {
	if s == nil || s.identities == nil {
		return "", ErrUserStorageKeyUnavailable
	}
	return s.identities.StorageKey(ctx, userID)
}

func (s *ImageStorageSettingService) localAssetUploadLoop() {
	const (
		workerLimit = 4
		pollDelay   = 2 * time.Second
	)
	slots := make(chan struct{}, workerLimit)
	for {
		pending, err := s.localAssets.ListPending(100)
		if err != nil {
			logger.L().Warn("image_storage.local_asset_scan_failed", zap.Error(err))
		}
		for _, meta := range pending {
			if meta == nil {
				continue
			}
			if _, loaded := s.uploading.LoadOrStore(meta.ID, struct{}{}); loaded {
				continue
			}
			slots <- struct{}{}
			go func(item *LocalImageAssetMetadata) {
				defer func() {
					s.uploading.Delete(item.ID)
					<-slots
				}()
				uploader, enabled := s.resolve()
				if !enabled || uploader == nil || uploader.storage == nil {
					return
				}
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
				defer cancel()
				s.uploadLocalAsset(ctx, item, uploader)
			}(meta)
		}
		time.Sleep(pollDelay)
	}
}

func (s *ImageStorageSettingService) uploadLocalAsset(
	ctx context.Context,
	item *LocalImageAssetMetadata,
	uploader *ImageResultUploader,
) {
	if s == nil || s.localAssets == nil || item == nil || uploader == nil || uploader.storage == nil {
		return
	}
	_, data, readErr := s.localAssets.Read(item.ID)
	if readErr != nil {
		if !errors.Is(readErr, ErrLocalImageAssetNotFound) {
			logger.L().Warn("image_storage.local_asset_read_failed",
				zap.String("asset_id", item.ID), zap.Error(readErr))
		}
		return
	}
	remoteURL, saveErr := uploader.storage.Save(ctx, item.ObjectKey, item.ContentType, data)
	if saveErr != nil {
		logger.L().Warn("image_storage.local_asset_upload_failed",
			zap.String("asset_id", item.ID),
			zap.String("object_key", item.ObjectKey),
			zap.Error(saveErr))
		return
	}
	if markErr := s.localAssets.MarkUploaded(item.ID, remoteURL); markErr != nil {
		logger.L().Warn("image_storage.local_asset_mark_uploaded_failed",
			zap.String("asset_id", item.ID), zap.Error(markErr))
	}
}

func NewImageStorageSettingService(
	settingRepo SettingRepository,
	encryptor SecretEncryptor,
	backup *BackupService,
	factory ImageStorageFactory,
	fallback config.ImageStorageConfig,
) *ImageStorageSettingService {
	return &ImageStorageSettingService{
		settingRepo: settingRepo,
		encryptor:   encryptor,
		backup:      backup,
		factory:     factory,
		fallback:    fallback,
	}
}

// Resolver 返回可注入 ImageTaskService 的解析函数。
func (s *ImageStorageSettingService) Resolver() ImageStorageResolver {
	return func() (*ImageResultUploader, bool) {
		return s.resolve()
	}
}

// SaveImage stores an image using the currently effective image storage
// configuration. It is used by user-facing gallery uploads.
func (s *ImageStorageSettingService) SaveImage(ctx context.Context, key, contentType string, data []byte) (string, error) {
	url, _, err := s.SaveImageWithKey(ctx, key, contentType, data)
	return url, err
}

// SaveImageWithKey 与 SaveImage 一样写对象，但会额外返回最终的对象键。
// 作品库需要它：键里带配置的 Key 前缀，删除时必须用同一个键才能删到文件。
func (s *ImageStorageSettingService) SaveImageWithKey(
	ctx context.Context, key, contentType string, data []byte,
) (string, string, error) {
	return s.saveImageWithKey(ctx, key, contentType, data, true)
}

// SaveImageWithFullKey writes the exact key supplied by the caller. Canvas
// objects use this so their public path is canvas/{storage_key}/... rather than
// being forced under the generic images/ prefix.
func (s *ImageStorageSettingService) SaveImageWithFullKey(
	ctx context.Context, key, contentType string, data []byte,
) (string, string, error) {
	return s.saveImageWithKey(ctx, key, contentType, data, false)
}

func (s *ImageStorageSettingService) saveImageWithKey(
	ctx context.Context, key, contentType string, data []byte, applyPrefix bool,
) (string, string, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return "", "", reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return "", "", ErrImageStorageIncomplete
	}
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if applyPrefix {
		key = uploader.prefix + key
	}
	if storage, ok := uploader.storage.(ImageStorageWithExpiry); ok {
		url, err := storage.SaveWithExpiry(ctx, key, contentType, data, s.GalleryRetention())
		return url, key, err
	}
	url, err := uploader.storage.Save(ctx, key, contentType, data)
	return url, key, err
}

// Status 解析当前生效状态。ReuseBackupS3 打开时以备份凭证的实际取值为准，
// 这样"勾了复用但备份那块是空的"也能被准确报成缺凭证，而不是看起来配好了。
func (s *ImageStorageSettingService) Status(ctx context.Context) ImageStorageStatus {
	if s == nil {
		return ImageStorageStatus{Missing: missingImageStorageFields(nil)}
	}
	stored, err := s.load(ctx)
	if err != nil {
		return ImageStorageStatus{Missing: missingImageStorageFields(nil)}
	}
	if stored == nil {
		// 从未保存过：以 config.yaml 的回落配置为准。
		fallback := s.fallback
		missing := missingImageStorageFields(&fallback)
		return ImageStorageStatus{
			Ready:   fallback.Enabled && len(missing) == 0,
			Enabled: fallback.Enabled,
			Missing: missing,
		}
	}
	cfg, err := s.toImageStorageConfig(ctx, stored)
	if err != nil || cfg == nil {
		// 例：勾了"复用备份 S3"但备份配置为空。开关确实是开着的，
		// 只是拿不到可用凭证，所以 Enabled 必须如实返回，缺项按未解析处理。
		return ImageStorageStatus{Enabled: stored.Enabled, Missing: missingImageStorageFields(nil)}
	}
	missing := missingImageStorageFields(cfg)
	return ImageStorageStatus{
		Ready:   cfg.Enabled && len(missing) == 0,
		Enabled: cfg.Enabled,
		Missing: missing,
	}
}

// unusableReason 把"现在为什么不能落盘"归一成两种可区分的错误。
func (s *ImageStorageSettingService) unusableReason(ctx context.Context) error {
	status := s.Status(ctx)
	if status.Ready {
		return nil
	}
	if !status.Enabled {
		return ErrImageStorageDisabled
	}
	if len(status.Missing) == 0 {
		return ErrImageStorageIncomplete
	}
	// 把缺的字段直接写进消息：调用方拿到的就是"还差什么"，不用再去翻服务端日志。
	return infraerrors.New(
		http.StatusServiceUnavailable,
		"IMAGE_STORAGE_INCOMPLETE",
		"image storage credentials are incomplete; missing: "+strings.Join(status.Missing, ", "),
	)
}

// missingImageStorageFields 报告缺失的必填项，字段名与后台表单一一对应。
func missingImageStorageFields(cfg *config.ImageStorageConfig) []string {
	if cfg == nil {
		return []string{"bucket", "access_key_id", "secret_access_key"}
	}
	missing := make([]string, 0, 3)
	if strings.TrimSpace(cfg.Bucket) == "" {
		missing = append(missing, "bucket")
	}
	if strings.TrimSpace(cfg.AccessKeyID) == "" {
		missing = append(missing, "access_key_id")
	}
	if strings.TrimSpace(cfg.SecretAccessKey) == "" {
		missing = append(missing, "secret_access_key")
	}
	return missing
}

// FetchImageURL 在服务端下载上游图片，供图库转存使用。
// 浏览器直接抓上游链接会受 CORS 限制，且上游多为短期签名地址，服务端抓取更可靠。
func (s *ImageStorageSettingService) FetchImageURL(ctx context.Context, rawURL string) ([]byte, string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if s == nil || rawURL == "" {
		return nil, "", ErrImageStorageIncomplete
	}
	if s.localAssets != nil {
		if assetID, ok := s.localAssets.AssetIDFromURL(rawURL); ok {
			meta, metaErr := s.localAssets.Get(assetID)
			if metaErr != nil {
				return nil, "", metaErr
			}
			if meta.Uploaded && strings.TrimSpace(meta.RemoteURL) != "" {
				rawURL = strings.TrimSpace(meta.RemoteURL)
				if remoteURL, resolveErr := s.PresignImageObject(ctx, meta.ObjectKey); resolveErr == nil && remoteURL != "" {
					rawURL = remoteURL
				}
			} else {
				data, contentType, _, readErr := s.localAssets.ReadURL(ctx, rawURL)
				if readErr == nil && len(data) > 0 {
					return data, contentType, nil
				}
				if readErr != nil && !errors.Is(readErr, ErrLocalImageAssetNotFound) {
					return nil, "", readErr
				}
				// MarkUploaded writes metadata before removing the local file. A
				// reader that raced that transition must re-check metadata so it
				// can follow the uploaded object instead of returning a 404.
				latest, latestErr := s.localAssets.Get(assetID)
				if latestErr != nil || !latest.Uploaded || strings.TrimSpace(latest.RemoteURL) == "" {
					return nil, "", ErrLocalImageAssetNotFound
				}
				rawURL = strings.TrimSpace(latest.RemoteURL)
				if remoteURL, resolveErr := s.PresignImageObject(ctx, latest.ObjectKey); resolveErr == nil && remoteURL != "" {
					rawURL = remoteURL
				}
			}
		}
	}
	if reason := s.unusableReason(ctx); reason != nil {
		if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
			downloader := NewImageResultUploader(nil, "", s.maxDownloadBytes(), nil)
			return downloader.download(ctx, rawURL)
		}
		return nil, "", reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil {
		return nil, "", ErrImageStorageIncomplete
	}
	return uploader.download(ctx, rawURL)
}

func (s *ImageStorageSettingService) maxDownloadBytes() int64 {
	cfg, err := s.effectiveConfig(context.Background())
	if err == nil && cfg != nil && cfg.MaxDownloadByte > 0 {
		return cfg.MaxDownloadByte
	}
	return defaultImageMaxDownloadBytes
}

func (s *ImageStorageSettingService) PresignImageObject(ctx context.Context, objectKey string) (string, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return "", reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return "", ErrImageStorageIncomplete
	}
	resolver, ok := uploader.storage.(ImageStorageURLResolver)
	if !ok {
		return "", ErrImageStorageIncomplete
	}
	return resolver.PresignGet(ctx, objectKey)
}

// PresignImageUpload returns a short-lived browser upload URL for an exact
// object key and content type. The browser never receives R2 credentials.
func (s *ImageStorageSettingService) PresignImageUpload(
	ctx context.Context,
	objectKey string,
	contentType string,
) (ImageStorageUploadRequest, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return ImageStorageUploadRequest{}, reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return ImageStorageUploadRequest{}, ErrImageStorageIncomplete
	}
	resolver, ok := uploader.storage.(ImageStorageUploadURLResolver)
	if !ok {
		return ImageStorageUploadRequest{}, ErrImageStorageIncomplete
	}
	return resolver.PresignPut(ctx, objectKey, contentType, imageStorageUploadPresignTTL)
}

func (s *ImageStorageSettingService) ImageObjectStat(
	ctx context.Context,
	objectKey string,
) (ImageObjectMetadata, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return ImageObjectMetadata{}, reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return ImageObjectMetadata{}, ErrImageStorageIncomplete
	}
	resolver, ok := uploader.storage.(ImageStorageObjectStatResolver)
	if !ok {
		return ImageObjectMetadata{}, ErrImageStorageIncomplete
	}
	return resolver.Stat(ctx, objectKey)
}

func (s *ImageStorageSettingService) ReadImageObjectPrefix(
	ctx context.Context,
	objectKey string,
	length int64,
) ([]byte, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return nil, reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return nil, ErrImageStorageIncomplete
	}
	reader, ok := uploader.storage.(ImageStorageObjectPrefixReader)
	if !ok {
		return nil, ErrImageStorageIncomplete
	}
	return reader.ReadPrefix(ctx, objectKey, length)
}

func (s *ImageStorageSettingService) CopyImageObject(
	ctx context.Context,
	sourceKey string,
	targetKey string,
	contentType string,
) error {
	if reason := s.unusableReason(ctx); reason != nil {
		return reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return ErrImageStorageIncomplete
	}
	copier, ok := uploader.storage.(ImageStorageObjectCopier)
	if !ok {
		return ErrImageStorageIncomplete
	}
	return copier.Copy(ctx, sourceKey, targetKey, contentType)
}

func (s *ImageStorageSettingService) PresignImageObjectDownload(
	ctx context.Context,
	objectKey string,
	filename string,
) (string, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return "", reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return "", ErrImageStorageIncomplete
	}
	resolver, ok := uploader.storage.(ImageStorageDownloadURLResolver)
	if !ok {
		return "", ErrImageStorageIncomplete
	}
	return resolver.PresignGetDownload(ctx, objectKey, filename)
}

func (s *ImageStorageSettingService) PresignImageObjects(
	ctx context.Context,
	objectKeys []string,
) (map[string]string, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return nil, reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return nil, ErrImageStorageIncomplete
	}
	resolver, ok := uploader.storage.(ImageStorageURLResolver)
	if !ok {
		return nil, ErrImageStorageIncomplete
	}
	resolved := make(map[string]string, len(objectKeys))
	for _, objectKey := range objectKeys {
		objectKey = strings.TrimSpace(objectKey)
		if objectKey == "" {
			continue
		}
		url, err := resolver.PresignGet(ctx, objectKey)
		if err != nil {
			continue
		}
		resolved[objectKey] = url
	}
	return resolved, nil
}

func (s *ImageStorageSettingService) ImageObjectExists(ctx context.Context, objectKey string) (bool, error) {
	if reason := s.unusableReason(ctx); reason != nil {
		return false, reason
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return false, ErrImageStorageIncomplete
	}
	resolver, ok := uploader.storage.(ImageStorageURLResolver)
	if !ok {
		return false, ErrImageStorageIncomplete
	}
	return resolver.Exists(ctx, objectKey)
}

func (s *ImageStorageSettingService) resolve() (*ImageResultUploader, bool) {
	if s == nil {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if s.resolved && s.backup != nil &&
		s.backupConfigGeneration != s.backup.S3ConfigGeneration() {
		s.resolved = false
	}
	if s.resolved && now.Sub(s.resolvedAt) < imageStorageSettingsCacheTTL {
		return s.uploader, s.enabled
	}

	ctx := context.Background()
	s.resolved = true
	s.resolvedAt = now
	s.uploader, s.enabled = nil, false
	s.galleryRetention = ImageStudioGalleryTTL
	s.studioQuota = StudioWorksQuotaPerUser
	if s.backup != nil {
		s.backupConfigGeneration = s.backup.S3ConfigGeneration()
	}

	cfg, err := s.effectiveConfig(ctx)
	if err != nil {
		logger.L().Warn("image_storage.settings_load_failed; async image tasks stay disabled", zap.Error(err))
		return nil, false
	}
	// 配额跟存储开关无关：即使存储没配好，后台设的上限也要能读到并展示给用户。
	if cfg.StudioWorksQuota > 0 {
		s.studioQuota = cfg.StudioWorksQuota
	}
	if !cfg.Enabled {
		return nil, false
	}
	if !cfg.IsConfigured() {
		logger.L().Warn("image_storage is enabled but not fully configured; async image tasks are disabled",
			zap.Strings("missing_keys", cfg.MissingCredentialKeys()))
		return nil, false
	}

	storage, err := s.factory(ctx, cfg)
	if err != nil {
		logger.L().Error("image_storage.client_build_failed; async image tasks stay disabled", zap.Error(err))
		return nil, false
	}
	s.uploader = NewImageResultUploader(storage, cfg.Prefix, cfg.MaxDownloadByte, nil)
	s.uploader.SetLocalAssets(s.localAssets)
	s.uploader.SetUserStorageIdentityResolver(s.identities)
	s.enabled = true
	if cfg.GalleryRetentionDays > 0 {
		s.galleryRetention = time.Duration(cfg.GalleryRetentionDays) * 24 * time.Hour
	}
	return s.uploader, true
}

// DeleteObject 按完整 key 删除对象存储里的文件。用户删除作品时调用：
// 先删文件再删记录，删文件失败就把错误抛出去，记录保留以便重试。
func (s *ImageStorageSettingService) DeleteObject(ctx context.Context, key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil
	}
	if s.localAssets != nil {
		if err := s.localAssets.DeleteByObjectKey(key); err != nil {
			return err
		}
	}
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return ErrImageStorageIncomplete
	}
	deleter, ok := uploader.storage.(ImageStorageDeleter)
	if !ok {
		return ErrImageStorageIncomplete
	}
	return deleter.Delete(ctx, key)
}

// StudioWorksQuota 返回后台配置的作品配额（图片 + 视频合计）。
// 设置里没写或者解析失败时回落到内置默认值，保证永远是个正数。
func (s *ImageStorageSettingService) StudioWorksQuota() int {
	if s == nil {
		return StudioWorksQuotaPerUser
	}
	_, _ = s.resolve()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.studioQuota > 0 {
		return s.studioQuota
	}
	return StudioWorksQuotaPerUser
}

func (s *ImageStorageSettingService) GalleryRetention() time.Duration {
	if s == nil {
		return ImageStudioGalleryTTL
	}
	_, _ = s.resolve()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.galleryRetention > 0 {
		return s.galleryRetention
	}
	return ImageStudioGalleryTTL
}

// Invalidate 丢弃缓存，使下一次请求按最新设置重新解析。
func (s *ImageStorageSettingService) Invalidate() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.resolved = false
	s.resolvedAt = time.Time{}
	s.uploader = nil
	s.enabled = false
	s.galleryRetention = ImageStudioGalleryTTL
	s.studioQuota = StudioWorksQuotaPerUser
	s.mu.Unlock()
}

// Get 返回后台设置（SecretAccessKey 已脱敏）。从未保存过时返回 config.yaml 的等价值。
func (s *ImageStorageSettingService) Get(ctx context.Context) (*ImageStorageSettings, error) {
	settings, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	if settings == nil {
		settings = settingsFromConfig(s.fallback)
	}
	settings.SecretAccessKey = ""
	return settings, nil
}

// SecretConfigured 供前端展示"已配置"占位符。
func (s *ImageStorageSettingService) SecretConfigured(ctx context.Context) bool {
	settings, err := s.load(ctx)
	if err != nil || settings == nil {
		return s.fallback.SecretAccessKey != ""
	}
	if settings.ReuseBackupS3 {
		cfg, err := s.backupCredentials(ctx)
		return err == nil && cfg != nil && cfg.SecretAccessKey != ""
	}
	return settings.SecretAccessKey != ""
}

// Update 保存设置并立即生效。SecretAccessKey 留空表示沿用已保存的值。
func (s *ImageStorageSettingService) Update(ctx context.Context, in ImageStorageSettings) (*ImageStorageSettings, error) {
	normalizeImageStorageSettings(&in)

	if in.ReuseBackupS3 {
		// 复用备份凭证时不落自己的密钥，避免同一份密钥在库里存两份。
		in.Endpoint, in.Region, in.AccessKeyID, in.SecretAccessKey = "", "", "", ""
		in.ForcePathStyle = false
	} else if in.SecretAccessKey == "" {
		if old, err := s.load(ctx); err == nil && old != nil {
			in.SecretAccessKey = old.SecretAccessKey
		}
	} else {
		// 拒绝用自动生成的临时密钥加密：重启后密文无法解密（#4524）。
		// 与备份 S3 配置共用同一把密钥，故复用其配置状态判断。
		if s.backup == nil || !s.backup.EncryptionKeyConfigured() {
			return nil, ErrSecretEncryptionKeyNotConfigured
		}
		encrypted, err := s.encryptor.Encrypt(in.SecretAccessKey)
		if err != nil {
			return nil, fmt.Errorf("encrypt secret: %w", err)
		}
		in.SecretAccessKey = encrypted
	}

	data, err := json.Marshal(in)
	if err != nil {
		return nil, fmt.Errorf("marshal image storage settings: %w", err)
	}
	if err := s.settingRepo.Set(ctx, settingKeyImageStorageConfig, string(data)); err != nil {
		return nil, fmt.Errorf("save image storage settings: %w", err)
	}
	s.Invalidate()

	in.SecretAccessKey = ""
	return &in, nil
}

// TestConnection 用给定设置试建一次客户端，用于后台的"测试连接"按钮。
// 与 Update 一样支持留空 SecretAccessKey 表示沿用已保存的值。
func (s *ImageStorageSettingService) TestConnection(ctx context.Context, in ImageStorageSettings) error {
	normalizeImageStorageSettings(&in)
	if !in.ReuseBackupS3 && in.SecretAccessKey == "" {
		old, err := s.load(ctx)
		if err == nil && old != nil {
			in.SecretAccessKey = old.SecretAccessKey
		}
	}
	cfg, err := s.toImageStorageConfig(ctx, &in)
	if err != nil {
		return err
	}
	if !cfg.IsConfigured() {
		return ErrImageStorageIncomplete
	}
	storage, err := s.factory(ctx, cfg)
	if err != nil {
		return err
	}
	if checker, ok := storage.(ImageStorageConnectionChecker); ok {
		if err := checker.HeadBucket(ctx); err != nil {
			// Some S3-compatible providers deny HeadBucket to object-scoped
			// credentials even when the bucket accepts PutObject. The write
			// probe below matches the actual image-save path, so it decides.
			logger.L().Warn("image_storage.head_bucket_probe_failed",
				zap.String("bucket", cfg.Bucket),
				zap.Error(err))
		}
	}
	// HeadBucket only proves the bucket exists and is readable. R2/OSS tokens are
	// commonly scoped read-only, which passes that probe but makes every gallery
	// upload fail later. Write and remove a tiny probe object so the admin test
	// reflects what image saving actually needs.
	probeKey := path.Join(cfg.Prefix, fmt.Sprintf(".connection-test-%d.txt", time.Now().UnixNano()))
	if _, err := storage.Save(ctx, probeKey, "text/plain", []byte("ok")); err != nil {
		return infraerrors.New(
			http.StatusServiceUnavailable,
			"IMAGE_STORAGE_WRITE_TEST_FAILED",
			"S3 write test failed: "+err.Error(),
		)
	}
	if deleter, ok := storage.(ImageStorageDeleter); ok {
		_ = deleter.Delete(ctx, probeKey)
	}
	return nil
}

// effectiveConfig 把后台设置（或 config.yaml 回落）解析成运行时配置。
func (s *ImageStorageSettingService) effectiveConfig(ctx context.Context) (*config.ImageStorageConfig, error) {
	settings, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	if settings == nil {
		fallback := s.fallback
		return &fallback, nil
	}
	return s.toImageStorageConfig(ctx, settings)
}

func (s *ImageStorageSettingService) toImageStorageConfig(ctx context.Context, in *ImageStorageSettings) (*config.ImageStorageConfig, error) {
	cfg := &config.ImageStorageConfig{
		Enabled:              in.Enabled,
		Bucket:               in.Bucket,
		Prefix:               in.Prefix,
		PublicBaseURL:        in.PublicBaseURL,
		PresignExpiry:        in.PresignExpiry,
		GalleryRetentionDays: in.GalleryRetentionDays,
		StudioWorksQuota:     in.StudioWorksQuota,
		MaxDownloadByte:      in.MaxDownloadBytes,
		Endpoint:             in.Endpoint,
		Region:               in.Region,
		AccessKeyID:          in.AccessKeyID,
		SecretAccessKey:      in.SecretAccessKey,
		ForcePathStyle:       in.ForcePathStyle,
	}

	if in.ReuseBackupS3 {
		backupCfg, err := s.backupCredentials(ctx)
		if err != nil {
			return nil, err
		}
		if backupCfg == nil {
			return nil, errors.New("image storage is set to reuse the backup S3 configuration, but no backup S3 configuration exists")
		}
		cfg.Endpoint = backupCfg.Endpoint
		cfg.Region = backupCfg.Region
		cfg.AccessKeyID = backupCfg.AccessKeyID
		cfg.SecretAccessKey = backupCfg.SecretAccessKey
		cfg.ForcePathStyle = backupCfg.ForcePathStyle
		if cfg.Bucket == "" {
			cfg.Bucket = backupCfg.Bucket
		}
	} else if cfg.SecretAccessKey != "" {
		decrypted, err := s.encryptor.Decrypt(cfg.SecretAccessKey)
		if err != nil {
			// 兼容未加密的旧数据，与备份配置的处理保持一致。
			logger.L().Warn("image_storage secret decrypt failed; treating the stored value as plaintext", zap.Error(err))
		} else {
			cfg.SecretAccessKey = decrypted
		}
	}
	return cfg, nil
}

// backupCredentials 取备份已配置的 S3 凭证（已解密）。
func (s *ImageStorageSettingService) backupCredentials(ctx context.Context) (*BackupS3Config, error) {
	if s.backup == nil {
		return nil, errors.New("backup service is unavailable")
	}
	return s.backup.loadS3Config(ctx)
}

// load 读出后台设置；从未保存过时返回 nil。
func (s *ImageStorageSettingService) load(ctx context.Context) (*ImageStorageSettings, error) {
	if s.settingRepo == nil {
		return nil, nil //nolint:nilnil // no repository means no stored settings
	}
	raw, err := s.settingRepo.GetValue(ctx, settingKeyImageStorageConfig)
	if err != nil || strings.TrimSpace(raw) == "" {
		return nil, nil //nolint:nilnil // never configured is a valid state
	}
	var settings ImageStorageSettings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return nil, fmt.Errorf("parse image storage settings: %w", err)
	}
	return &settings, nil
}

func settingsFromConfig(cfg config.ImageStorageConfig) *ImageStorageSettings {
	return &ImageStorageSettings{
		Enabled:              cfg.Enabled,
		Bucket:               cfg.Bucket,
		Prefix:               cfg.Prefix,
		PublicBaseURL:        cfg.PublicBaseURL,
		PresignExpiry:        cfg.PresignExpiry,
		GalleryRetentionDays: cfg.GalleryRetentionDays,
		StudioWorksQuota:     cfg.StudioWorksQuota,
		MaxDownloadBytes:     cfg.MaxDownloadByte,
		Endpoint:             cfg.Endpoint,
		Region:               cfg.Region,
		AccessKeyID:          cfg.AccessKeyID,
		SecretAccessKey:      cfg.SecretAccessKey,
		ForcePathStyle:       cfg.ForcePathStyle,
	}
}

func normalizeImageStorageSettings(in *ImageStorageSettings) {
	in.Bucket = strings.TrimSpace(in.Bucket)
	in.Endpoint = strings.TrimSpace(in.Endpoint)
	in.Region = strings.TrimSpace(in.Region)
	in.AccessKeyID = strings.TrimSpace(in.AccessKeyID)
	in.SecretAccessKey = strings.TrimSpace(in.SecretAccessKey)
	in.PublicBaseURL = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(in.PublicBaseURL), "/"))

	in.Prefix = strings.TrimSpace(in.Prefix)
	if in.Prefix == "" {
		in.Prefix = "images/"
	}
	if !strings.HasSuffix(in.Prefix, "/") {
		in.Prefix += "/"
	}
	if in.Region == "" {
		in.Region = "auto"
	}
	if in.PresignExpiry <= 0 {
		in.PresignExpiry = 24
	}
	if in.GalleryRetentionDays <= 0 {
		in.GalleryRetentionDays = 7
	}
	if in.GalleryRetentionDays > 365 {
		in.GalleryRetentionDays = 365
	}
	// 作品配额：留空或填 0 表示用默认值；上限 10000，避免误填天文数字把库撑坏。
	if in.StudioWorksQuota <= 0 {
		in.StudioWorksQuota = StudioWorksQuotaPerUser
	}
	if in.StudioWorksQuota > 10000 {
		in.StudioWorksQuota = 10000
	}
	if in.MaxDownloadBytes <= 0 {
		in.MaxDownloadBytes = defaultImageMaxDownloadBytes
	}
}
