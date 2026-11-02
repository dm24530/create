package handler

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
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
	if h == nil || result == nil {
		return
	}
	recordUsageImageOutputs(ctx, apiKey, result.RequestID, result.ImageOutputs, h.imageLinks, h.imageStorage)
}

func (h *OpenAIGatewayHandler) recordUsageImageLink(
	ctx context.Context,
	apiKey *service.APIKey,
	requestIDHint string,
	outputs []service.GeminiImageOutput,
) {
	if h == nil {
		return
	}
	recordUsageImageOutputs(ctx, apiKey, requestIDHint, outputs, h.imageLinks, h.imageStorage)
}

func recordUsageImageOutputs(
	ctx context.Context,
	apiKey *service.APIKey,
	requestIDHint string,
	outputs []service.GeminiImageOutput,
	imageLinks service.UsageLogImageLinkStore,
	imageStorage *service.ImageStorageSettingService,
) {
	if imageLinks == nil || apiKey == nil || len(outputs) == 0 {
		return
	}
	userID := apiKey.UserID
	if userID <= 0 && apiKey.User != nil {
		userID = apiKey.User.ID
	}
	if userID <= 0 {
		return
	}
	requestID := service.ResolveUsageBillingRequestID(ctx, requestIDHint)
	if strings.TrimSpace(requestID) == "" {
		return
	}

	imageURL := ""
	for _, output := range outputs {
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
	persistentLink := strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://")
	if imageStorage != nil {
		data, contentType, ok := usageImageBytes(linkCtx, imageStorage, outputs, imageURL)
		if ok {
			contentType = normalizedUsageImageContentType(data, contentType)
			storageKey, storageErr := imageStorage.StorageKeyForUser(linkCtx, userID)
			if storageErr != nil {
				logger.L().Warn("usage_image_link.storage_key_failed",
					zap.Int64("user_id", userID),
					zap.String("request_id", requestID),
					zap.Error(storageErr))
			} else {
				key := usageImageObjectKey(storageKey, requestID, contentType)
				if resolvedURL, storedKey, err := imageStorage.SaveImageWithKey(linkCtx, key, contentType, data); err == nil {
					imageURL = resolvedURL
					objectKey = storedKey
					persistentLink = true
				} else {
					logger.L().Warn("usage_image_link.persist_failed",
						zap.Int64("user_id", userID),
						zap.String("request_id", requestID),
						zap.Error(err))
				}
			}
		}
	}
	// Inline image bodies may be many megabytes. If object storage cannot take
	// them, leave the usage row without an image link instead of copying the
	// whole data URL into PostgreSQL for 90 days.
	if !persistentLink {
		return
	}
	if err := imageLinks.Upsert(linkCtx, &service.UsageLogImageLink{
		UserID:    userID,
		APIKeyID:  apiKey.ID,
		RequestID: requestID,
		ImageURL:  imageURL,
		ObjectKey: objectKey,
	}); err != nil {
		logger.L().Warn("usage_image_link.store_failed",
			zap.Int64("user_id", userID),
			zap.Int64("api_key_id", apiKey.ID),
			zap.String("request_id", requestID),
			zap.Error(err))
	}
}

func normalizedUsageImageContentType(data []byte, declared string) string {
	if len(data) > 0 {
		detected := strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0])
		if strings.HasPrefix(strings.ToLower(detected), "image/") {
			return detected
		}
	}
	return strings.TrimSpace(declared)
}

func usageImageBytes(
	ctx context.Context,
	imageStorage *service.ImageStorageSettingService,
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
	if imageStorage == nil || !strings.HasPrefix(fallbackURL, "http") {
		return nil, "", false
	}
	data, contentType, err := imageStorage.FetchImageURL(ctx, fallbackURL)
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
