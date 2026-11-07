package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	geminiRemoteImageMaxBytes = 16 << 20
	geminiRemoteImageTimeout  = 20 * time.Second
)

type geminiRemoteImage struct {
	data        []byte
	contentType string
}

func inlineGeminiRemoteFileData(ctx context.Context, body []byte) ([]byte, bool, error) {
	return rewriteGeminiRemoteFileData(ctx, body, func(ctx context.Context, sourceURL string) (*geminiRemoteImage, error) {
		return downloadGeminiRemoteImage(ctx, sourceURL)
	})
}

func rewriteGeminiRemoteFileData(
	ctx context.Context,
	body []byte,
	fetch func(context.Context, string) (*geminiRemoteImage, error),
) ([]byte, bool, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return body, false, err
	}
	contents, ok := payload["contents"].([]any)
	if !ok || len(contents) == 0 {
		return body, false, nil
	}

	changed := false
	for _, rawContent := range contents {
		content, ok := rawContent.(map[string]any)
		if !ok {
			continue
		}
		parts, ok := content["parts"].([]any)
		if !ok {
			continue
		}
		for _, rawPart := range parts {
			part, ok := rawPart.(map[string]any)
			if !ok {
				continue
			}
			fileData, key, ok := geminiFileDataPart(part)
			if !ok {
				continue
			}
			sourceURL, _ := firstString(fileData, "fileUri", "file_uri")
			if !isInlineableGeminiFileURL(sourceURL) {
				continue
			}
			image, err := fetch(ctx, sourceURL)
			if err != nil || image == nil || len(image.data) == 0 {
				continue
			}
			mimeType, _ := firstString(fileData, "mimeType", "mime_type")
			if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
				mimeType = image.contentType
			}
			if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
				mimeType = http.DetectContentType(image.data)
			}
			if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
				continue
			}
			delete(part, key)
			part["inlineData"] = map[string]any{
				"mimeType": mimeType,
				"data":     base64.StdEncoding.EncodeToString(image.data),
			}
			changed = true
		}
	}
	if !changed {
		return body, false, nil
	}
	rewritten, err := json.Marshal(payload)
	if err != nil {
		return body, false, err
	}
	return rewritten, true, nil
}

func geminiFileDataPart(part map[string]any) (map[string]any, string, bool) {
	for _, key := range []string{"fileData", "file_data"} {
		fileData, ok := part[key].(map[string]any)
		if ok {
			return fileData, key, true
		}
	}
	return nil, "", false
}

func firstString(values map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := values[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value), true
		}
	}
	return "", false
}

func isInlineableGeminiFileURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "cloudflarestorage.com" || strings.HasSuffix(host, ".r2.cloudflarestorage.com")
}

func downloadGeminiRemoteImage(ctx context.Context, sourceURL string) (*geminiRemoteImage, error) {
	requestCtx, cancel := context.WithTimeout(ctx, geminiRemoteImageTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.New("remote image download failed")
	}

	reader := io.LimitReader(resp.Body, geminiRemoteImageMaxBytes+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > geminiRemoteImageMaxBytes {
		return nil, errors.New("remote image is empty or too large")
	}
	contentType := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	return &geminiRemoteImage{data: data, contentType: contentType}, nil
}
