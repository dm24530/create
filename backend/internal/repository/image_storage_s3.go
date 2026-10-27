package repository

import (
	"bytes"
	"context"
	"fmt"
	"mime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/servertiming"
	"github.com/Wei-Shaw/sub2api/internal/service"
)

// S3ImageStorage 用 S3 兼容对象存储实现 service.ImageStorage。
type S3ImageStorage struct {
	client        *s3.Client
	bucket        string
	publicBaseURL string
	presignExpiry time.Duration
}

const (
	imageMultipartThreshold         = 5 << 20
	imageMultipartPartSize          = 5 << 20
	imageMultipartConcurrency       = 8
	imageMultipartGlobalConcurrency = 16
)

var imageMultipartPartSlots = make(chan struct{}, imageMultipartGlobalConcurrency)

var _ service.ImageStorage = (*S3ImageStorage)(nil)
var _ service.ImageStorageURLResolver = (*S3ImageStorage)(nil)
var _ service.ImageStorageDownloadURLResolver = (*S3ImageStorage)(nil)

// NewS3ImageStorage 依据配置构造 S3 图片存储（调用方应先确认 cfg.Active()）。
func NewS3ImageStorage(ctx context.Context, cfg *config.ImageStorageConfig) (*S3ImageStorage, error) {
	client, err := newS3Client(ctx, s3ClientParams{
		Endpoint:        cfg.Endpoint,
		Region:          cfg.Region,
		AccessKeyID:     cfg.AccessKeyID,
		SecretAccessKey: cfg.SecretAccessKey,
		ForcePathStyle:  cfg.ForcePathStyle,
	})
	if err != nil {
		return nil, err
	}

	expiry := time.Duration(cfg.PresignExpiry) * time.Hour
	if expiry <= 0 {
		expiry = 24 * time.Hour
	}

	return &S3ImageStorage{
		client:        client,
		bucket:        cfg.Bucket,
		publicBaseURL: strings.TrimRight(cfg.PublicBaseURL, "/"),
		presignExpiry: expiry,
	}, nil
}

// Save 上传图片字节，返回可访问 URL：配了 public_base_url 则返回公开直链，否则返回 presigned 临时链接。
func (s *S3ImageStorage) Save(ctx context.Context, key, contentType string, data []byte) (string, error) {
	return s.SaveWithExpiry(ctx, key, contentType, data, s.presignExpiry)
}

// SaveWithExpiry is Save with an explicit presigned URL lifetime.
func (s *S3ImageStorage) SaveWithExpiry(ctx context.Context, key, contentType string, data []byte, expiry time.Duration) (string, error) {
	if len(data) >= imageMultipartThreshold {
		if err := s.putMultipart(ctx, key, contentType, data); err != nil {
			return "", err
		}
		return s.resultURL(ctx, key, expiry)
	}

	finish := servertiming.ObserveDependency(ctx, "s3")
	input := &s3.PutObjectInput{
		Bucket:      &s.bucket,
		Key:         &key,
		Body:        bytes.NewReader(data),
		ContentType: &contentType,
	}
	if s.publicBaseURL != "" {
		cacheControl := "public, max-age=31536000, immutable"
		input.CacheControl = &cacheControl
	}
	_, err := s.client.PutObject(ctx, input)
	finish()
	if err != nil {
		return "", fmt.Errorf("S3 PutObject: %w", err)
	}
	return s.resultURL(ctx, key, expiry)
}

func (s *S3ImageStorage) resultURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if s.publicBaseURL != "" {
		return s.publicBaseURL + "/" + strings.TrimLeft(key, "/"), nil
	}

	if expiry <= 0 {
		expiry = s.presignExpiry
	}
	presignClient := s3.NewPresignClient(s.client)
	result, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &s.bucket,
		Key:    &key,
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign url: %w", err)
	}
	return result.URL, nil
}

func (s *S3ImageStorage) putMultipart(ctx context.Context, key, contentType string, data []byte) error {
	finish := servertiming.ObserveDependency(ctx, "s3")
	defer finish()

	input := &s3.CreateMultipartUploadInput{
		Bucket:      &s.bucket,
		Key:         &key,
		ContentType: &contentType,
	}
	if s.publicBaseURL != "" {
		cacheControl := "public, max-age=31536000, immutable"
		input.CacheControl = &cacheControl
	}
	created, err := s.client.CreateMultipartUpload(ctx, input)
	if err != nil {
		return fmt.Errorf("S3 CreateMultipartUpload: %w", err)
	}
	if created.UploadId == nil || *created.UploadId == "" {
		return fmt.Errorf("S3 CreateMultipartUpload: empty upload ID")
	}
	uploadID := *created.UploadId

	abort := func() {
		abortCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = s.client.AbortMultipartUpload(abortCtx, &s3.AbortMultipartUploadInput{
			Bucket:   &s.bucket,
			Key:      &key,
			UploadId: &uploadID,
		})
	}

	partCount := (len(data) + imageMultipartPartSize - 1) / imageMultipartPartSize
	completed := make([]types.CompletedPart, partCount)
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex
	uploadCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan int)

	for worker := 0; worker < imageMultipartConcurrency; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				start := index * imageMultipartPartSize
				end := min(start+imageMultipartPartSize, len(data))
				partNumber := int32(index + 1)
				select {
				case imageMultipartPartSlots <- struct{}{}:
				case <-uploadCtx.Done():
					continue
				}
				part, uploadErr := s.client.UploadPart(uploadCtx, &s3.UploadPartInput{
					Bucket:     &s.bucket,
					Key:        &key,
					UploadId:   &uploadID,
					PartNumber: &partNumber,
					Body:       bytes.NewReader(data[start:end]),
				})
				<-imageMultipartPartSlots
				if uploadErr != nil {
					errMu.Lock()
					if firstErr == nil {
						firstErr = fmt.Errorf("S3 UploadPart %d: %w", partNumber, uploadErr)
						cancel()
					}
					errMu.Unlock()
					continue
				}
				etag := ""
				if part.ETag != nil {
					etag = *part.ETag
				}
				completed[index] = types.CompletedPart{ETag: &etag, PartNumber: &partNumber}
			}
		}()
	}

feed:
	for index := 0; index < partCount; index++ {
		select {
		case jobs <- index:
		case <-uploadCtx.Done():
			break feed
		}
	}
	close(jobs)
	wg.Wait()
	if firstErr != nil {
		abort()
		return firstErr
	}
	if err := ctx.Err(); err != nil {
		abort()
		return err
	}
	sort.Slice(completed, func(i, j int) bool {
		return *completed[i].PartNumber < *completed[j].PartNumber
	})
	_, err = s.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:   &s.bucket,
		Key:      &key,
		UploadId: &uploadID,
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: completed,
		},
	})
	if err != nil {
		abort()
		return fmt.Errorf("S3 CompleteMultipartUpload: %w", err)
	}
	return nil
}

func (s *S3ImageStorage) PresignGet(ctx context.Context, key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", fmt.Errorf("S3 object key is required")
	}
	if s.publicBaseURL != "" {
		return s.publicBaseURL + "/" + strings.TrimLeft(key, "/"), nil
	}
	presignClient := s3.NewPresignClient(s.client)
	result, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &s.bucket,
		Key:    &key,
	}, s3.WithPresignExpires(s.presignExpiry))
	if err != nil {
		return "", fmt.Errorf("presign url: %w", err)
	}
	return result.URL, nil
}

func (s *S3ImageStorage) PresignGetDownload(ctx context.Context, key, filename string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", fmt.Errorf("S3 object key is required")
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{
		"filename": strings.TrimSpace(filename),
	})
	presignClient := s3.NewPresignClient(s.client)
	result, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:                     &s.bucket,
		Key:                        &key,
		ResponseContentDisposition: &disposition,
	}, s3.WithPresignExpires(s.presignExpiry))
	if err != nil {
		return "", fmt.Errorf("presign download url: %w", err)
	}
	return result.URL, nil
}

func (s *S3ImageStorage) Exists(ctx context.Context, key string) (bool, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return false, nil
	}
	finish := servertiming.ObserveDependency(ctx, "s3")
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: &s.bucket,
		Key:    &key,
	})
	finish()
	if err != nil {
		// A missing object is an expected terminal state for expired works.
		return false, nil
	}
	return true, nil
}

// HeadBucket verifies that the configured bucket exists and the credentials
// can access it. The admin test button uses this instead of only constructing
// an SDK client, which performs no network request.
func (s *S3ImageStorage) HeadBucket(ctx context.Context) error {
	finish := servertiming.ObserveDependency(ctx, "s3")
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: &s.bucket,
	})
	finish()
	if err != nil {
		return fmt.Errorf("S3 HeadBucket failed: %w", err)
	}
	return nil
}

// Delete 删除对象存储里的一个对象。S3 的 DeleteObject 本身是幂等的：
// 对象不存在也返回成功，所以重复删除不会报错。
func (s *S3ImageStorage) Delete(ctx context.Context, key string) error {
	finish := servertiming.ObserveDependency(ctx, "s3")
	defer finish()
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: &s.bucket,
		Key:    &key,
	})
	if err != nil {
		return fmt.Errorf("S3 DeleteObject: %w", err)
	}
	return nil
}
