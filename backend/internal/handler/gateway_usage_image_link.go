package handler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"path"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"go.uber.org/zap"
)

func (h *GatewayHandler) recordUsageImageLink(
	ctx context.Context,
	apiKey *service.APIKey,
	result *service.ForwardResult,
) {
	if h == nil || h.imageLinks == nil || apiKey == nil || result == nil || len(result.ImageOutputs) == 0 {
		return
	}
	requestID := service.ResolveUsageBillingRequestID(ctx, result.RequestID)
	if strings.TrimSpace(requestID) == "" {
		return
	}

	imageURL := ""
	for _, output := range result.ImageOutputs {
		if value := strings.TrimSpace(output.URL); value != "" {
			imageURL = value
			break
		}
		if value := strings.TrimSpace(output.Base64); value != "" {
			mimeType := strings.TrimSpace(output.MIMEType)
			if mimeType == "" {
				mimeType = "image/png"
			}
			imageURL = "data:" + mimeType + ";base64," + value
			break
		}
	}
	if imageURL == "" {
		return
	}

	objectKey := ""
	linkCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer cancel()
	if h.imageStorage != nil {
		data, contentType, ok := h.usageImageBytes(linkCtx, result.ImageOutputs, imageURL)
		if ok {
			storageKey, storageErr := h.imageStorage.StorageKeyForUser(linkCtx, apiKey.UserID)
			if storageErr != nil {
				logger.L().Warn("usage_image_link.storage_key_failed",
					zap.Int64("user_id", apiKey.UserID),
					zap.String("request_id", requestID),
					zap.Error(storageErr))
			} else {
				key := usageImageObjectKey(storageKey, requestID, contentType)
				if resolvedURL, storedKey, err := h.imageStorage.SaveImageWithKey(linkCtx, key, contentType, data); err == nil {
					imageURL = resolvedURL
					objectKey = storedKey
				} else {
					logger.L().Warn("usage_image_link.persist_failed",
						zap.Int64("user_id", apiKey.UserID),
						zap.String("request_id", requestID),
						zap.Error(err))
				}
			}
		}
	}
	if err := h.imageLinks.Upsert(linkCtx, &service.UsageLogImageLink{
		UserID:    apiKey.UserID,
		APIKeyID:  apiKey.ID,
		RequestID: requestID,
		ImageURL:  imageURL,
		ObjectKey: objectKey,
	}); err != nil {
		logger.L().Warn("usage_image_link.store_failed",
			zap.Int64("user_id", apiKey.UserID),
			zap.Int64("api_key_id", apiKey.ID),
			zap.String("request_id", requestID),
			zap.Error(err))
	}
}

func (h *GatewayHandler) usageImageBytes(
	ctx context.Context,
	outputs []service.GeminiImageOutput,
	fallbackURL string,
) ([]byte, string, bool) {
	for _, output := range outputs {
		if base64Data := strings.TrimSpace(output.Base64); base64Data != "" {
			data, err := base64.StdEncoding.DecodeString(base64Data)
			if err == nil && len(data) > 0 {
				contentType := strings.TrimSpace(output.MIMEType)
				if contentType == "" || !strings.HasPrefix(contentType, "image/") {
					contentType = "image/png"
				}
				return data, contentType, true
			}
		}
	}
	if h == nil || h.imageStorage == nil || !strings.HasPrefix(fallbackURL, "http") {
		return nil, "", false
	}
	data, contentType, err := h.imageStorage.FetchImageURL(ctx, fallbackURL)
	if err != nil || len(data) == 0 {
		return nil, "", false
	}
	if !strings.HasPrefix(contentType, "image/") {
		contentType = "image/png"
	}
	return data, contentType, true
}

func usageImageObjectKey(storageKey, requestID, contentType string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(requestID)))
	return path.Join(
		strings.TrimSpace(storageKey),
		"usage-"+hex.EncodeToString(sum[:])+imageExtension(contentType),
	)
}

func imageExtension(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/avif":
		return ".avif"
	default:
		return ".png"
	}
}
