package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/color/palette"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"go.uber.org/zap"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const defaultImageMaxDownloadBytes int64 = 32 << 20 // 32 MiB

type ImageRewriteOptions struct {
	OutputFormat string
}

func NormalizeImageOutputFormat(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "jpeg", "jpg":
		return "jpeg"
	case "png":
		return "png"
	case "gif":
		return "gif"
	default:
		return ""
	}
}

func ImageOutputFormatFromContentType(contentType string) string {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch {
	case strings.Contains(contentType, "jpeg"), strings.Contains(contentType, "jpg"):
		return "jpeg"
	case strings.Contains(contentType, "png"):
		return "png"
	case strings.Contains(contentType, "webp"):
		return "webp"
	case strings.Contains(contentType, "gif"):
		return "gif"
	default:
		extensions, err := mime.ExtensionsByType(contentType)
		if err != nil || len(extensions) == 0 {
			return ""
		}
		return strings.TrimPrefix(strings.ToLower(extensions[0]), ".")
	}
}

func ImageOutputFormatFromObjectKey(objectKey string) string {
	extension := strings.TrimPrefix(strings.ToLower(path.Ext(strings.TrimSpace(objectKey))), ".")
	return NormalizeImageOutputFormat(extension)
}

func TranscodeImageOutput(data []byte, contentType, outputFormat string) ([]byte, string, error) {
	targetFormat := NormalizeImageOutputFormat(outputFormat)
	if targetFormat == "" || len(data) == 0 {
		return data, contentType, nil
	}
	declaredContentType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	contentType = detectedImageContentType(data)
	if contentType == "" {
		contentType = declaredContentType
	}
	if targetFormat != "jpeg" && targetFormat != "png" {
		return data, contentType, nil
	}
	if (targetFormat == "jpeg" && contentType == "image/jpeg") ||
		(targetFormat == "png" && contentType == "image/png") {
		return data, contentType, nil
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("decode image for %s conversion: %w", targetFormat, err)
	}
	var output bytes.Buffer
	switch targetFormat {
	case "jpeg":
		encodeSource := source
		if opaque, ok := source.(interface{ Opaque() bool }); !ok || !opaque.Opaque() {
			encodeSource = flattenImageOnWhite(source)
		}
		if err := jpeg.Encode(&output, encodeSource, &jpeg.Options{Quality: 92}); err != nil {
			return nil, "", fmt.Errorf("encode JPEG: %w", err)
		}
		return output.Bytes(), "image/jpeg", nil
	case "png":
		if err := png.Encode(&output, source); err != nil {
			return nil, "", fmt.Errorf("encode PNG: %w", err)
		}
		return output.Bytes(), "image/png", nil
	default:
		return data, contentType, nil
	}
}

func flattenImageOnWhite(source image.Image) *image.YCbCr {
	bounds := source.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	destination := image.NewYCbCr(
		image.Rect(0, 0, width, height),
		image.YCbCrSubsampleRatio420,
	)
	const maxChannel = uint32(0xffff)
	for y := 0; y < height; y += 2 {
		for x := 0; x < width; x += 2 {
			chromaSum := [2]int{}
			samples := 0
			for dy := 0; dy < 2 && y+dy < height; dy++ {
				for dx := 0; dx < 2 && x+dx < width; dx++ {
					red, green, blue, alpha := source.At(bounds.Min.X+x+dx, bounds.Min.Y+y+dy).RGBA()
					red += maxChannel - alpha
					green += maxChannel - alpha
					blue += maxChannel - alpha
					if red > maxChannel {
						red = maxChannel
					}
					if green > maxChannel {
						green = maxChannel
					}
					if blue > maxChannel {
						blue = maxChannel
					}
					yy, cb, cr := color.RGBToYCbCr(
						uint8(red>>8),
						uint8(green>>8),
						uint8(blue>>8),
					)
					destination.Y[destination.YOffset(destination.Rect.Min.X+x+dx, destination.Rect.Min.Y+y+dy)] = yy
					chromaSum[0] += int(cb)
					chromaSum[1] += int(cr)
					samples++
				}
			}
			if samples == 0 {
				continue
			}
			chromaIndex := destination.COffset(destination.Rect.Min.X+x, destination.Rect.Min.Y+y)
			destination.Cb[chromaIndex] = uint8(chromaSum[0] / samples)
			destination.Cr[chromaIndex] = uint8(chromaSum[1] / samples)
		}
	}
	return destination
}

// ImageStorage 把图片字节写入对象存储并返回可访问 URL。
//
// 这是对象存储的可插拔抽象：适配一个新的对象存储厂商，只需实现本接口
// （例如包一个厂商 SDK），无需改动任务/网关逻辑。仓库内自带一个 S3 兼容实现
// （repository.S3ImageStorage），适用于 AWS S3 / Cloudflare R2 / 阿里云 OSS / MinIO 等。
type ImageStorage interface {
	// Save 把 data 以 key 存入对象存储，返回可下载的 URL（公开直链或 presigned 临时链接）。
	// contentType 为图片 MIME 类型，如 "image/png"。
	Save(ctx context.Context, key, contentType string, data []byte) (url string, err error)
}

// ImageStorageWithExpiry supports per-object presigned URL lifetimes.
type ImageStorageWithExpiry interface {
	SaveWithExpiry(ctx context.Context, key, contentType string, data []byte, expiry time.Duration) (url string, err error)
}

// ImageStorageDeleter 支持按 key 删除对象。用户删除作品时用它清理桶里的文件，
// 没有实现这个接口的存储不影响写入，只是删作品时无法连带删文件。
type ImageStorageDeleter interface {
	Delete(ctx context.Context, key string) error
}

type ImageStorageURLResolver interface {
	PresignGet(ctx context.Context, key string) (string, error)
	Exists(ctx context.Context, key string) (bool, error)
}

// ImageStorageUploadURLResolver creates a short-lived direct-upload URL for an
// exact object key. R2/Go SDK presigning does not consistently include
// Content-Type in SignedHeaders, so callers must verify the landed object with
// ImageStorageObjectStatResolver before making it visible.
type ImageStorageUploadURLResolver interface {
	PresignPut(ctx context.Context, key, contentType string, expiry time.Duration) (ImageStorageUploadRequest, error)
}

type ImageStorageUploadRequest struct {
	URL     string
	Headers map[string]string
}

// ImageObjectMetadata verifies what actually landed in object storage after a
// direct browser upload. Size and content type are checked before the asset is
// made visible in a canvas.
type ImageObjectMetadata struct {
	Bytes       int64
	ContentType string
	ETag        string
}

// ImageObjectInfo is a lightweight listing entry used by retention jobs.
type ImageObjectInfo struct {
	Key          string
	LastModified time.Time
}

type ImageStorageObjectLister interface {
	ListObjects(ctx context.Context, prefix string) ([]ImageObjectInfo, error)
}

type ImageStorageObjectStatResolver interface {
	Stat(ctx context.Context, key string) (ImageObjectMetadata, error)
}

type ImageStorageObjectPrefixReader interface {
	ReadPrefix(ctx context.Context, key string, length int64) ([]byte, error)
}

type ImageStorageObjectCopier interface {
	Copy(ctx context.Context, sourceKey, targetKey, contentType string) error
}

// ImageStorageDownloadURLResolver creates a short-lived direct object URL with
// an attachment response. Large originals should be downloaded by the browser
// directly instead of proxying the entire object through the application.
type ImageStorageDownloadURLResolver interface {
	PresignGetDownload(ctx context.Context, key, filename string) (string, error)
}

// ImageResultUploader 是 ImageStorage 的上层编排器（与具体厂商无关）：
// 把上游生图响应里的每张图片（b64_json 解码 / url 下载）转存到对象存储，
// 并把响应结果改写为只含短链接的紧凑 JSON，从而避免大 base64 落 Redis。
type ImageResultUploader struct {
	storage          ImageStorage
	localAssets      *LocalImageAssetStore
	httpClient       *http.Client
	prefix           string
	maxDownloadBytes int64
	identities       UserStorageIdentityResolver
}

// NewImageResultUploader 构造一个 uploader；storage 为 nil 时 Rewrite 直接透传。
func NewImageResultUploader(storage ImageStorage, prefix string, maxDownloadBytes int64, httpClient *http.Client) *ImageResultUploader {
	if httpClient == nil {
		httpClient = defaultImageDownloadHTTPClient()
	}
	if maxDownloadBytes <= 0 {
		maxDownloadBytes = defaultImageMaxDownloadBytes
	}
	return &ImageResultUploader{
		storage:          storage,
		httpClient:       httpClient,
		prefix:           prefix,
		maxDownloadBytes: maxDownloadBytes,
	}
}

func (u *ImageResultUploader) SetLocalAssets(store *LocalImageAssetStore) {
	if u == nil {
		return
	}
	u.localAssets = store
}

func (u *ImageResultUploader) SetUserStorageIdentityResolver(identities UserStorageIdentityResolver) {
	if u == nil {
		return
	}
	u.identities = identities
}

func defaultImageDownloadHTTPClient() *http.Client {
	baseTransport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		baseTransport = &http.Transport{}
	}
	transport := baseTransport.Clone()
	// Do not let an environment proxy bypass the socket-level SSRF checks.
	transport.Proxy = nil
	transport.DialContext = safeDialContext
	return &http.Client{
		Timeout:   60 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many image download redirects")
			}
			return validateImageDownloadURL(req.URL)
		},
	}
}

func validateImageDownloadURL(target *url.URL) error {
	if target == nil {
		return errors.New("image download URL is required")
	}
	switch strings.ToLower(strings.TrimSpace(target.Scheme)) {
	case "http", "https":
	default:
		return fmt.Errorf("unsupported image download scheme %q", target.Scheme)
	}
	if target.User != nil {
		return errors.New("image download URL must not contain credentials")
	}
	host := strings.TrimSpace(target.Hostname())
	if host == "" || isBlockedHostname(host) {
		return fmt.Errorf("image download host is not allowed: %q", host)
	}
	return nil
}

// OpenImageStream proxies an upstream image without exposing its URL to the
// caller. The response body is returned as-is so previews and downloads can
// start before the complete image has been buffered by the API server.
func (u *ImageResultUploader) OpenImageStream(
	ctx context.Context,
	rawURL string,
) (io.ReadCloser, string, error) {
	body, contentType, err := u.OpenMediaStream(ctx, rawURL)
	if err != nil {
		return nil, "", err
	}
	if strings.HasPrefix(strings.ToLower(contentType), "image/") {
		return body, contentType, nil
	}
	_ = body.Close()
	return nil, "", errors.New("upstream response is not an image")
}

// OpenMediaStream proxies image, audio, or video bytes through the API server.
// The caller must only pass URLs that were resolved from private server state.
func (u *ImageResultUploader) OpenMediaStream(
	ctx context.Context,
	rawURL string,
) (io.ReadCloser, string, error) {
	if u == nil || u.httpClient == nil {
		return nil, "", errors.New("image download client is unavailable")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, "", errors.New("image download URL is invalid")
	}
	if err := validateImageDownloadURL(parsed); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", errors.New("build image download request")
	}
	req.Header.Set("Accept", "image/*,video/*,audio/*,*/*;q=0.8")
	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, "", errors.New("image download failed")
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_ = resp.Body.Close()
		return nil, "", fmt.Errorf("image download returned status %d", resp.StatusCode)
	}

	contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	if contentType == "image/svg+xml" || contentType == "image/svg" || contentType == "text/html" {
		_ = resp.Body.Close()
		return nil, "", errors.New("upstream media format is not supported for proxying")
	}
	var body io.Reader = resp.Body
	if contentType == "" || contentType == "application/octet-stream" {
		buffered := bufio.NewReader(resp.Body)
		header, _ := buffered.Peek(512)
		detected := http.DetectContentType(header)
		if !strings.HasPrefix(detected, "image/") &&
			!strings.HasPrefix(detected, "video/") &&
			!strings.HasPrefix(detected, "audio/") {
			_ = resp.Body.Close()
			return nil, "", errors.New("upstream response is not media")
		}
		contentType = detected
		body = buffered
	}
	if !strings.HasPrefix(contentType, "image/") &&
		!strings.HasPrefix(contentType, "video/") &&
		!strings.HasPrefix(contentType, "audio/") {
		_ = resp.Body.Close()
		return nil, "", errors.New("upstream response is not media")
	}
	return &imageStreamReadCloser{Reader: body, Closer: resp.Body}, contentType, nil
}

type imageStreamReadCloser struct {
	io.Reader
	io.Closer
}

// Rewrite 将 result（上游生图响应 JSON）里的每张图片转存到对象存储，
// 返回改写后的紧凑结果（data[i].url 指向对象存储，b64_json 被移除）。
// 任一图片转存失败即返回 error（调用方据此将任务标记为失败，绝不把大 blob 落 Redis）。
func (u *ImageResultUploader) Rewrite(ctx context.Context, userID int64, taskID string, result json.RawMessage) (json.RawMessage, error) {
	return u.RewriteWithPreview(ctx, userID, taskID, result, nil)
}

// PersistPreviewResult turns an already-published preview into a durable image.
// Recovery uses it after a process restart when the full-size original was lost:
// the user keeps a saveable preview, but the upstream request is never repeated.
func (u *ImageResultUploader) PersistPreviewResult(
	ctx context.Context,
	userID int64,
	taskID string,
	result json.RawMessage,
) (json.RawMessage, error) {
	if u == nil || (u.storage == nil && u.localAssets == nil) {
		return nil, errors.New("image storage is unavailable")
	}
	if userID <= 0 {
		return nil, errors.New("image owner user ID is required")
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(result, &top); err != nil {
		return nil, fmt.Errorf("parse preview response: %w", err)
	}
	rawData, ok := top["data"]
	if !ok {
		return nil, errors.New("preview response has no data")
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(rawData, &items); err != nil {
		return nil, fmt.Errorf("parse preview response data: %w", err)
	}
	storageKey := "users/" + strconv.FormatInt(userID, 10)
	if u.identities != nil {
		resolved, err := u.identities.StorageKey(ctx, userID)
		if err != nil {
			return nil, err
		}
		storageKey = resolved
	}
	expiresAt := time.Now().UTC().Add(defaultImageTaskTTL).Unix()
	for i, item := range items {
		data, contentType, err := u.fetchImageBytes(ctx, item)
		if err != nil {
			return nil, fmt.Errorf("preview image %d: %w", i, err)
		}
		key := u.buildKey(storageKey, taskID, i, contentType)
		if u.localAssets != nil {
			meta, saveErr := u.localAssets.Save(ctx, userID, taskID, key, contentType, expiresAt, data)
			if saveErr != nil {
				return nil, fmt.Errorf("preview image %d: stage local: %w", i, saveErr)
			}
			setImageItemPublicURLs(item, u.localAssets.URL(meta.ID), "")
			item["local_asset_id"] = encodedJSON(meta.ID)
		} else {
			url, saveErr := u.storage.Save(ctx, key, contentType, data)
			if saveErr != nil {
				return nil, fmt.Errorf("preview image %d: upload: %w", i, saveErr)
			}
			setImageItemPublicURLs(item, url, "")
		}
		item["object_key"] = encodedJSON(key)
		item["mime_type"] = encodedJSON(contentType)
		item["preview_fallback"] = encodedJSON(true)
		delete(item, "b64_json")
		items[i] = item
	}
	sanitizeImageResultTopLevel(top)
	return imageResultWithItems(top, items)
}

// RewriteWithPreview uploads lightweight previews first, then stores the full
// originals. The preview callback lets the task API surface an image before the
// potentially large original upload to object storage has finished.
func (u *ImageResultUploader) RewriteWithPreview(
	ctx context.Context,
	userID int64,
	taskID string,
	result json.RawMessage,
	onPreview func(json.RawMessage) error,
	options ...ImageRewriteOptions,
) (json.RawMessage, error) {
	if u == nil || u.storage == nil {
		return result, nil
	}
	if userID <= 0 {
		return nil, fmt.Errorf("image owner user ID is required")
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(result, &top); err != nil {
		return nil, fmt.Errorf("parse image response: %w", err)
	}
	rawData, ok := top["data"]
	if !ok {
		// 没有 data 数组（结构不符合预期），保持原样返回，交由上层决定。
		return result, nil
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(rawData, &items); err != nil {
		return nil, fmt.Errorf("parse image response data: %w", err)
	}
	if len(items) == 0 {
		return result, nil
	}
	earlyPreviewPublished := false
	if onPreview != nil {
		earlyPreviewItems := upstreamPreviewItems(items)
		if len(earlyPreviewItems) > 0 {
			if err := onPreview(imagePreviewPayload(top, earlyPreviewItems)); err != nil {
				logger.L().Warn("image_storage.upstream_preview_publish_failed",
					zap.String("task_id", taskID),
					zap.Int64("user_id", userID),
					zap.Error(err))
			} else {
				earlyPreviewPublished = true
			}
		}
	}
	storageKey := "users/" + strconv.FormatInt(userID, 10)
	if u.identities != nil {
		resolved, err := u.identities.StorageKey(ctx, userID)
		if err != nil {
			return nil, err
		}
		storageKey = resolved
	}

	type preparedImage struct {
		item           map[string]json.RawMessage
		data           []byte
		contentType    string
		key            string
		previewDataURL string
	}

	prepared := make([]preparedImage, len(items))
	outputFormat := ""
	if len(options) > 0 {
		outputFormat = options[0].OutputFormat
	}
	for i, item := range items {
		data, contentType, err := u.fetchImageBytes(ctx, item)
		if err != nil {
			return nil, fmt.Errorf("image %d: %w", i, err)
		}
		prepared[i] = preparedImage{
			item:        item,
			data:        data,
			contentType: contentType,
		}
	}

	for i := range prepared {
		data, contentType, err := TranscodeImageOutput(
			prepared[i].data,
			prepared[i].contentType,
			outputFormat,
		)
		if err != nil {
			return nil, fmt.Errorf("image %d: %w", i, err)
		}
		prepared[i].data = data
		prepared[i].contentType = contentType
		prepared[i].key = u.buildKey(storageKey, taskID, i, contentType)
		if previewDataURL := buildPreviewDataURL(data); previewDataURL != "" {
			prepared[i].previewDataURL = previewDataURL
		}
	}

	if onPreview != nil && !earlyPreviewPublished {
		previewItems := make([]map[string]json.RawMessage, 0, len(prepared))
		for i := range prepared {
			if prepared[i].previewDataURL == "" {
				continue
			}
			previewItem, cloneErr := cloneImageItem(prepared[i].item)
			if cloneErr != nil {
				continue
			}
			previewItem["url"] = encodedJSON(prepared[i].previewDataURL)
			previewItem["preview_url"] = encodedJSON(prepared[i].previewDataURL)
			previewItem["preview_data_url"] = encodedJSON(prepared[i].previewDataURL)
			previewItem["mime_type"] = encodedJSON("image/jpeg")
			delete(previewItem, "b64_json")
			delete(previewItem, "display_url")
			delete(previewItem, "local_asset_id")
			delete(previewItem, "object_key")
			previewItems = append(previewItems, previewItem)
		}
		if len(previewItems) > 0 {
			if err := onPreview(imagePreviewPayload(top, previewItems)); err != nil {
				logger.L().Warn("image_storage.generated_preview_publish_failed",
					zap.String("task_id", taskID),
					zap.Int64("user_id", userID),
					zap.Error(err))
			} else {
				earlyPreviewPublished = true
			}
		}
	}

	localPreviewItems := make([]map[string]json.RawMessage, 0, len(prepared))
	if u.localAssets != nil {
		expiresAt := time.Now().UTC().Add(defaultImageTaskTTL).Unix()
		stagedKeys := make([]string, 0, len(prepared))
		var stageErr error
		for i := range prepared {
			meta, err := u.localAssets.Save(
				ctx,
				userID,
				taskID,
				prepared[i].key,
				prepared[i].contentType,
				expiresAt,
				prepared[i].data,
			)
			if err != nil {
				stageErr = fmt.Errorf("image %d: stage local original: %w", i, err)
				break
			}
			stagedKeys = append(stagedKeys, prepared[i].key)
			item, cloneErr := cloneImageItem(prepared[i].item)
			if cloneErr != nil {
				stageErr = fmt.Errorf("image %d: prepare local result: %w", i, cloneErr)
				break
			}
			setImageItemPublicURLs(item, u.localAssets.URL(meta.ID), prepared[i].previewDataURL)
			displayURL := u.localAssets.URL(meta.ID)
			if prepared[i].previewDataURL != "" {
				displayURL = prepared[i].previewDataURL
			}
			item["display_url"] = encodedJSON(displayURL)
			item["local_asset_id"] = encodedJSON(meta.ID)
			item["object_key"] = encodedJSON(prepared[i].key)
			item["mime_type"] = encodedJSON(prepared[i].contentType)
			item["upload_status"] = encodedJSON("pending")
			delete(item, "b64_json")
			items[i] = item

			previewItem, previewErr := cloneImageItem(item)
			if previewErr != nil {
				stageErr = fmt.Errorf("image %d: prepare local preview: %w", i, previewErr)
				break
			}
			previewURL := prepared[i].previewDataURL
			if previewURL == "" {
				previewURL = u.localAssets.URL(meta.ID)
			}
			previewItem["url"] = encodedJSON(previewURL)
			previewItem["preview_url"] = encodedJSON(previewURL)
			if prepared[i].previewDataURL != "" {
				previewItem["preview_data_url"] = encodedJSON(prepared[i].previewDataURL)
			}
			delete(previewItem, "display_url")
			delete(previewItem, "local_asset_id")
			delete(previewItem, "object_key")
			localPreviewItems = append(localPreviewItems, previewItem)
		}
		if stageErr == nil {
			if onPreview != nil && !earlyPreviewPublished && len(localPreviewItems) > 0 {
				if err := onPreview(imagePreviewPayload(top, localPreviewItems)); err != nil {
					logger.L().Warn("image_storage.local_original_preview_publish_failed",
						zap.String("task_id", taskID),
						zap.Int64("user_id", userID),
						zap.Error(err))
				}
			}
			return imageResultWithItems(top, items)
		}
		for _, key := range stagedKeys {
			if stageErr != nil {
				_ = u.localAssets.DeleteByObjectKey(key)
			}
		}
		if stageErr != nil {
			logger.L().Warn("image_storage.local_stage_failed; falling back to direct object upload",
				zap.String("task_id", taskID),
				zap.Int64("user_id", userID),
				zap.Error(stageErr))
		}
	}

	const uploadWorkers = 3
	jobs := make(chan int)
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex
	for worker := 0; worker < uploadWorkers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				url, saveErr := u.storage.Save(ctx, prepared[index].key, prepared[index].contentType, prepared[index].data)
				if saveErr != nil {
					errMu.Lock()
					if firstErr == nil {
						firstErr = fmt.Errorf("image %d: upload to object storage: %w", index, saveErr)
					}
					errMu.Unlock()
					continue
				}
				item, cloneErr := cloneImageItem(prepared[index].item)
				if cloneErr != nil {
					errMu.Lock()
					if firstErr == nil {
						firstErr = fmt.Errorf("image %d: prepare result: %w", index, cloneErr)
					}
					errMu.Unlock()
					continue
				}
				setImageItemPublicURLs(item, url, prepared[index].previewDataURL)
				if prepared[index].previewDataURL != "" {
					item["display_url"] = encodedJSON(prepared[index].previewDataURL)
				}
				item["object_key"] = encodedJSON(prepared[index].key)
				item["mime_type"] = encodedJSON(prepared[index].contentType)
				delete(item, "b64_json")
				items[index] = item
			}
		}()
	}
	for i := range prepared {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}

	sanitizeImageResultTopLevel(top)
	return imageResultWithItems(top, items)
}

func sanitizeImageResultTopLevel(top map[string]json.RawMessage) {
	for _, key := range []string{
		"url",
		"preview_url",
		"preview_data_url",
		"display_url",
		"image_url",
		"download_url",
		"thumb_url",
		"thumbnail_url",
		"source_url",
	} {
		delete(top, key)
	}
}

func setImageItemPublicURLs(
	item map[string]json.RawMessage,
	publicURL string,
	previewDataURL string,
) {
	if item == nil {
		return
	}
	for _, key := range []string{
		"url",
		"preview_url",
		"preview_data_url",
		"display_url",
		"image_url",
		"download_url",
		"thumb_url",
		"thumbnail_url",
		"source_url",
	} {
		delete(item, key)
	}
	publicURL = strings.TrimSpace(publicURL)
	previewDataURL = strings.TrimSpace(previewDataURL)
	if publicURL != "" {
		item["url"] = encodedJSON(publicURL)
		item["display_url"] = encodedJSON(publicURL)
	}
	if previewDataURL != "" {
		item["preview_url"] = encodedJSON(previewDataURL)
		item["preview_data_url"] = encodedJSON(previewDataURL)
		item["display_url"] = encodedJSON(previewDataURL)
	}
}

func imageResultWithItems(top map[string]json.RawMessage, items []map[string]json.RawMessage) (json.RawMessage, error) {
	newData, err := json.Marshal(items)
	if err != nil {
		return nil, fmt.Errorf("encode image response data: %w", err)
	}
	top["data"] = newData
	out, err := json.Marshal(top)
	if err != nil {
		return nil, fmt.Errorf("encode image response: %w", err)
	}
	return out, nil
}

func cloneImageItem(item map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	data, err := json.Marshal(item)
	if err != nil {
		return nil, err
	}
	var cloned map[string]json.RawMessage
	if err := json.Unmarshal(data, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func imagePreviewPayload(
	top map[string]json.RawMessage,
	items []map[string]json.RawMessage,
) json.RawMessage {
	previewTop := make(map[string]json.RawMessage, 2)
	if created, ok := top["created"]; ok {
		previewTop["created"] = created
	}
	previewTop["data"] = encodedJSON(items)
	return encodedJSON(previewTop)
}

func upstreamPreviewItems(items []map[string]json.RawMessage) []map[string]json.RawMessage {
	previews := make([]map[string]json.RawMessage, 0, len(items))
	for _, item := range items {
		raw, ok := item["url"]
		if !ok {
			continue
		}
		var rawURL string
		if json.Unmarshal(raw, &rawURL) != nil {
			continue
		}
		previewURL := safeBrowserPreviewURL(rawURL)
		if previewURL == "" {
			continue
		}
		preview, err := cloneImageItem(item)
		if err != nil {
			continue
		}
		preview["url"] = encodedJSON(previewURL)
		preview["preview_url"] = encodedJSON(previewURL)
		preview["preview_data_url"] = encodedJSON(previewURL)
		delete(preview, "b64_json")
		delete(preview, "display_url")
		delete(preview, "local_asset_id")
		delete(preview, "object_key")
		previews = append(previews, preview)
	}
	return previews
}

func safeBrowserPreviewURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.User != nil {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return ""
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" || isBlockedHostname(host) {
		return ""
	}
	if ip := net.ParseIP(host); ip != nil && isPrivateIP(ip) {
		return ""
	}
	return parsed.String()
}

func encodedJSON(value any) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}

func buildImagePreview(data []byte, maxEdge int) ([]byte, string, error) {
	if detectedImageContentType(data) == "image/gif" {
		preview, err := buildAnimatedGIFPreview(data, maxEdge)
		return preview, "image/gif", err
	}
	return buildStaticImagePreview(data, maxEdge)
}

func buildStaticImagePreview(data []byte, maxEdge int) ([]byte, string, error) {
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	dst := resizeImageRGBA(source, maxEdge)
	var out bytes.Buffer
	if imageHasTransparency(source) {
		if err := png.Encode(&out, dst); err != nil {
			return nil, "", err
		}
		return out.Bytes(), "image/png", nil
	}
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 78}); err != nil {
		return nil, "", err
	}
	return out.Bytes(), "image/jpeg", nil
}

func resizeImageRGBA(source image.Image, maxEdge int) *image.RGBA {
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return image.NewRGBA(image.Rect(0, 0, 1, 1))
	}
	if maxEdge <= 0 {
		maxEdge = 1024
	}
	scale := float64(maxEdge) / float64(max(width, height))
	if scale > 1 {
		scale = 1
	}
	dstWidth := max(1, int(float64(width)*scale))
	dstHeight := max(1, int(float64(height)*scale))
	dst := image.NewRGBA(image.Rect(0, 0, dstWidth, dstHeight))
	xdraw.ApproxBiLinear.Scale(dst, dst.Bounds(), source, bounds, xdraw.Over, nil)
	return dst
}

func imageHasTransparency(source image.Image) bool {
	if opaque, ok := source.(interface{ Opaque() bool }); ok {
		return !opaque.Opaque()
	}
	return true
}

func buildAnimatedGIFPreview(data []byte, maxEdge int) ([]byte, error) {
	source, err := gif.DecodeAll(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if len(source.Image) == 0 {
		return nil, errors.New("GIF has no frames")
	}
	if maxEdge <= 0 {
		maxEdge = 512
	}
	if maxEdge > 512 {
		maxEdge = 512
	}
	width, height := source.Config.Width, source.Config.Height
	if width <= 0 || height <= 0 {
		bounds := source.Image[0].Bounds()
		width, height = bounds.Dx(), bounds.Dy()
	}
	scale := float64(maxEdge) / float64(max(width, height))
	if scale > 1 {
		scale = 1
	}
	dstWidth := max(1, int(float64(width)*scale))
	dstHeight := max(1, int(float64(height)*scale))

	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	frames := make([]*image.Paletted, 0, len(source.Image))
	gifPalette := append(append(color.Palette(nil), palette.Plan9[:255]...), color.Transparent)
	for _, frame := range source.Image {
		if frame == nil {
			continue
		}
		draw.Draw(canvas, frame.Bounds(), frame, frame.Bounds().Min, draw.Over)
		snapshot := image.NewRGBA(canvas.Bounds())
		draw.Draw(snapshot, snapshot.Bounds(), canvas, image.Point{}, draw.Src)
		dst := image.NewPaletted(image.Rect(0, 0, dstWidth, dstHeight), gifPalette)
		xdraw.ApproxBiLinear.Scale(dst, dst.Bounds(), snapshot, snapshot.Bounds(), xdraw.Over, nil)
		frames = append(frames, dst)
	}
	if len(frames) == 0 {
		return nil, errors.New("GIF has no decodable frames")
	}
	delays := append([]int(nil), source.Delay...)
	if len(delays) > len(frames) {
		delays = delays[:len(frames)]
	}
	for len(delays) < len(frames) {
		delays = append(delays, 10)
	}
	disposal := make([]byte, len(frames))
	for i := range disposal {
		disposal[i] = gif.DisposalNone
	}
	var out bytes.Buffer
	if err := gif.EncodeAll(&out, &gif.GIF{
		Image:     frames,
		Delay:     delays,
		LoopCount: source.LoopCount,
		Disposal:  disposal,
		Config: image.Config{
			ColorModel: frames[0].Palette,
			Width:      dstWidth,
			Height:     dstHeight,
		},
	}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func buildFastImagePreview(data []byte, maxEdge int) ([]byte, error) {
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
	xdraw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, bounds, xdraw.Over, nil)

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 76}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func buildPreviewDataURL(data []byte) string {
	if len(data) == 0 || detectedImageContentType(data) == "image/gif" {
		return ""
	}
	preview, err := buildFastImagePreview(data, 1024)
	if err != nil || len(preview) == 0 {
		return ""
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(preview)
}

func (u *ImageResultUploader) fetchImageBytes(ctx context.Context, item map[string]json.RawMessage) ([]byte, string, error) {
	if raw, ok := item["b64_json"]; ok {
		var b64 string
		if err := json.Unmarshal(raw, &b64); err == nil {
			if b64 = strings.TrimSpace(b64); b64 != "" {
				data, err := base64.StdEncoding.DecodeString(b64)
				if err != nil {
					return nil, "", fmt.Errorf("decode b64_json: %w", err)
				}
				return data, detectImageContentType(data), nil
			}
		}
	}
	if raw, ok := item["url"]; ok {
		var rawURL string
		if err := json.Unmarshal(raw, &rawURL); err == nil {
			if rawURL = strings.TrimSpace(rawURL); rawURL != "" {
				if len(rawURL) >= len("data:") && strings.EqualFold(rawURL[:len("data:")], "data:") {
					return u.decodeImageDataURL(rawURL)
				}
				return u.download(ctx, rawURL)
			}
		}
	}
	return nil, "", errors.New("image item has neither b64_json nor url")
}

func (u *ImageResultUploader) decodeImageDataURL(rawURL string) ([]byte, string, error) {
	header, payload, ok := strings.Cut(rawURL[len("data:"):], ",")
	if !ok {
		return nil, "", errors.New("decode image data URL: missing comma separator")
	}

	parts := strings.Split(header, ";")
	if strings.TrimSpace(parts[0]) == "" {
		return nil, "", errors.New("decode image data URL: missing media type")
	}
	base64Index := len(parts) - 1
	if base64Index < 1 || !strings.EqualFold(strings.TrimSpace(parts[base64Index]), "base64") {
		for i := 1; i < base64Index; i++ {
			if strings.EqualFold(strings.TrimSpace(parts[i]), "base64") {
				return nil, "", errors.New("decode image data URL: base64 marker must be the final header token")
			}
		}
		return nil, "", errors.New("decode image data URL: payload is not base64 encoded")
	}
	for i := 1; i < base64Index; i++ {
		if strings.EqualFold(strings.TrimSpace(parts[i]), "base64") {
			return nil, "", errors.New("decode image data URL: duplicate base64 marker")
		}
	}
	mediaTypeHeader := strings.Join(parts[:base64Index], ";")
	declaredType, _, err := mime.ParseMediaType(mediaTypeHeader)
	if err != nil {
		return nil, "", fmt.Errorf("decode image data URL: invalid media type: %w", err)
	}
	declaredType = strings.ToLower(declaredType)
	if !strings.HasPrefix(declaredType, "image/") {
		return nil, "", fmt.Errorf("decode image data URL: media type %q is not an image", declaredType)
	}

	limit := u.maxDownloadBytes
	if limit <= 0 {
		limit = defaultImageMaxDownloadBytes
	}
	decoder := base64.NewDecoder(base64.StdEncoding, strings.NewReader(payload))
	data, err := io.ReadAll(io.LimitReader(decoder, limit+1))
	if err != nil {
		return nil, "", fmt.Errorf("decode image data URL base64 payload: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, "", fmt.Errorf("decoded image data URL exceeds %d bytes", limit)
	}

	contentType := detectedImageContentType(data)
	if contentType == "" {
		contentType = declaredType
	}
	return data, contentType, nil
}

func (u *ImageResultUploader) download(ctx context.Context, rawURL string) ([]byte, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, "", fmt.Errorf("parse image download URL: %w", err)
	}
	if err := validateImageDownloadURL(parsed); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", fmt.Errorf("build download request: %w", err)
	}
	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("download image: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, "", fmt.Errorf("download image: unexpected status %d", resp.StatusCode)
	}
	limit := u.maxDownloadBytes
	if limit <= 0 {
		limit = defaultImageMaxDownloadBytes
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, "", fmt.Errorf("read image body: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, "", fmt.Errorf("downloaded image exceeds %d bytes", limit)
	}
	contentType := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if !strings.HasPrefix(contentType, "image/") {
		contentType = detectImageContentType(data)
	}
	return data, contentType, nil
}

func (u *ImageResultUploader) buildKey(storageKey, taskID string, index int, contentType string) string {
	return fmt.Sprintf(
		"%s%s/%s-%d%s",
		u.prefix,
		storageKey,
		taskID,
		index,
		extensionForContentType(contentType),
	)
}

func detectImageContentType(data []byte) string {
	if ct := detectedImageContentType(data); ct != "" {
		return ct
	}
	return "image/png"
}

func detectedImageContentType(data []byte) string {
	ct := strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0])
	if strings.HasPrefix(ct, "image/") {
		return ct
	}
	return ""
}

func extensionForContentType(ct string) string {
	switch {
	case strings.Contains(ct, "png"):
		return ".png"
	case strings.Contains(ct, "jpeg"), strings.Contains(ct, "jpg"):
		return ".jpg"
	case strings.Contains(ct, "webp"):
		return ".webp"
	case strings.Contains(ct, "gif"):
		return ".gif"
	default:
		return ".png"
	}
}
