package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/util/urlvalidator"
)

const (
	geminiRemoteImageMaxBytes             = 16 << 20
	geminiRemoteResponseFileMaxBytes      = 64 << 20
	geminiRemoteResponseFileMaxParts      = 4
	geminiRemoteResponseFileMaxTotalBytes = 96 << 20
	geminiRemoteImageTimeout              = 20 * time.Second
)

type geminiRemoteImage struct {
	data        []byte
	contentType string
}

type geminiRemoteFileFetcher func(context.Context, string) (*geminiRemoteImage, error)

var geminiFileURIJSONPattern = regexp.MustCompile(`(?i)("file(?:_?uri)"\s*:\s*)"(?:\\.|[^"\\])*"`)

type geminiResponseMediaBudget struct {
	attempts   int
	totalBytes int64
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

// sanitizeGeminiResponseFileData converts upstream file references into inline
// data before a response reaches the client. If the file cannot be fetched, the
// media part is removed instead of leaking the upstream URI.
func sanitizeGeminiResponseFileData(
	ctx context.Context,
	body []byte,
	fetch geminiRemoteFileFetcher,
) ([]byte, bool, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		redacted := redactGeminiFileURIJSON(body)
		return redacted, !bytes.Equal(redacted, body), err
	}
	candidates, ok := payload["candidates"].([]any)
	if !ok || len(candidates) == 0 {
		return body, false, nil
	}

	changed := false
	seenURLs := make(map[string]struct{})
	budget := &geminiResponseMediaBudget{}
	for _, rawCandidate := range candidates {
		candidate, ok := rawCandidate.(map[string]any)
		if !ok {
			continue
		}
		content, ok := candidate["content"].(map[string]any)
		if !ok {
			continue
		}
		parts, ok := content["parts"].([]any)
		if !ok || len(parts) == 0 {
			continue
		}

		sanitizedParts := make([]any, 0, len(parts))
		partsChanged := false
		for _, rawPart := range parts {
			part, ok := rawPart.(map[string]any)
			if !ok {
				sanitizedParts = append(sanitizedParts, rawPart)
				continue
			}
			inlineParts := make([]any, 0, 1)
			fileData, key, ok := geminiFileDataPart(part)
			if ok {
				sourceURL, _ := firstString(fileData, "fileUri", "file_uri")
				if sourceURL != "" {
					delete(part, key)
					changed = true
					partsChanged = true
					if !hasGeminiInlineData(part) {
						mimeType, _ := firstString(fileData, "mimeType", "mime_type")
						if inlineData := fetchGeminiResponseInlineData(
							ctx, sourceURL, mimeType, fetch, budget, seenURLs,
						); inlineData != nil {
							part["inlineData"] = inlineData
						}
					}
				}
			}

			if text, ok := part["text"].(string); ok && text != "" {
				replaced := geminiTextImageURLPattern.ReplaceAllStringFunc(text, func(raw string) string {
					trimmed, suffix := trimGeminiTextImageURL(raw)
					if !looksLikeGeminiImageURL(trimmed) {
						return raw
					}
					changed = true
					partsChanged = true
					if hasGeminiInlineData(part) {
						return suffix
					}
					if inlineData := fetchGeminiResponseInlineData(
						ctx, trimmed, "", fetch, budget, seenURLs,
					); inlineData != nil {
						inlineParts = append(inlineParts, map[string]any{"inlineData": inlineData})
					}
					return suffix
				})
				if replaced != text {
					part["text"] = replaced
				}
			}
			if len(part) > 0 {
				if text, ok := part["text"].(string); !ok || strings.TrimSpace(text) != "" || len(part) > 1 {
					sanitizedParts = append(sanitizedParts, part)
				}
			}
			sanitizedParts = append(sanitizedParts, inlineParts...)
		}
		if partsChanged {
			content["parts"] = sanitizedParts
		}
	}
	if !changed {
		return body, false, nil
	}
	rewritten, err := json.Marshal(payload)
	if err != nil {
		return redactGeminiFileURIJSON(body), true, err
	}
	return rewritten, true, nil
}

func trimGeminiTextImageURL(raw string) (string, string) {
	trimmed := strings.TrimRight(raw, ".,);]")
	return trimmed, raw[len(trimmed):]
}

func fetchGeminiResponseInlineData(
	ctx context.Context,
	rawURL string,
	declaredMIMEType string,
	fetch geminiRemoteFileFetcher,
	budget *geminiResponseMediaBudget,
	seenURLs map[string]struct{},
) map[string]any {
	if fetch == nil {
		return nil
	}
	normalizedURL, ok := fetchableGeminiResponseFileURL(rawURL)
	if !ok {
		return nil
	}
	if _, seen := seenURLs[normalizedURL]; seen {
		return nil
	}
	seenURLs[normalizedURL] = struct{}{}
	if budget == nil || budget.attempts >= geminiRemoteResponseFileMaxParts {
		return nil
	}
	budget.attempts++

	media, err := fetch(ctx, normalizedURL)
	if err != nil || media == nil || len(media.data) == 0 || len(media.data) > geminiRemoteResponseFileMaxBytes {
		return nil
	}
	if budget.totalBytes+int64(len(media.data)) > geminiRemoteResponseFileMaxTotalBytes {
		return nil
	}
	budget.totalBytes += int64(len(media.data))

	mimeType := strings.TrimSpace(declaredMIMEType)
	if mimeType == "" {
		mimeType = strings.TrimSpace(media.contentType)
	}
	if mimeType == "" {
		mimeType = http.DetectContentType(media.data)
	}
	if mimeType == "" {
		return nil
	}
	return map[string]any{
		"mimeType": mimeType,
		"data":     base64.StdEncoding.EncodeToString(media.data),
	}
}

func redactGeminiFileURIJSON(body []byte) []byte {
	if len(body) == 0 {
		return body
	}
	redacted := geminiFileURIJSONPattern.ReplaceAll(body, []byte(`$1""`))
	redacted = []byte(geminiTextImageURLPattern.ReplaceAllStringFunc(string(redacted), func(raw string) string {
		trimmed, suffix := trimGeminiTextImageURL(raw)
		if !looksLikeGeminiImageURL(trimmed) {
			return raw
		}
		return suffix
	}))
	return redacted
}

func hasGeminiInlineData(part map[string]any) bool {
	if _, ok := part["inlineData"].(map[string]any); ok {
		return true
	}
	if _, ok := part["inline_data"].(map[string]any); ok {
		return true
	}
	return false
}

func fetchableGeminiResponseFileURL(rawURL string) (string, bool) {
	normalized, err := urlvalidator.ValidateHTTPSURL(rawURL, urlvalidator.ValidationOptions{})
	if err != nil {
		return "", false
	}
	return normalized, true
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
	return downloadGeminiRemoteFileWith(ctx, sourceURL, http.DefaultClient.Do, geminiRemoteImageMaxBytes)
}

func downloadGeminiRemoteFileWith(
	ctx context.Context,
	sourceURL string,
	do func(*http.Request) (*http.Response, error),
	maxBytes int64,
) (*geminiRemoteImage, error) {
	requestCtx, cancel := context.WithTimeout(WithHTTPUpstreamPublicHostsOnly(ctx), geminiRemoteImageTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.New("remote image download failed")
	}

	reader := io.LimitReader(resp.Body, maxBytes+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || int64(len(data)) > maxBytes {
		return nil, errors.New("remote image is empty or too large")
	}
	contentType := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	return &geminiRemoteImage{data: data, contentType: contentType}, nil
}

func geminiResponseFileFetcherForAccount(upstream HTTPUpstream, account *Account) geminiRemoteFileFetcher {
	proxyURL := ""
	var accountID int64
	accountConcurrency := 0
	if account != nil {
		accountID = account.ID
		accountConcurrency = account.Concurrency
		if account.ProxyID != nil && account.Proxy != nil {
			proxyURL = account.Proxy.URL()
		}
	}

	do := http.DefaultClient.Do
	if upstream != nil {
		do = func(req *http.Request) (*http.Response, error) {
			return upstream.Do(req, proxyURL, accountID, accountConcurrency)
		}
	}
	return func(ctx context.Context, sourceURL string) (*geminiRemoteImage, error) {
		return downloadGeminiRemoteFileWith(ctx, sourceURL, do, geminiRemoteResponseFileMaxBytes)
	}
}

func sanitizeGeminiResponseFileDataForAccount(
	ctx context.Context,
	upstream HTTPUpstream,
	account *Account,
	body []byte,
) []byte {
	sanitized, _, _ := sanitizeGeminiResponseFileData(
		ctx,
		body,
		geminiResponseFileFetcherForAccount(upstream, account),
	)
	return sanitized
}
