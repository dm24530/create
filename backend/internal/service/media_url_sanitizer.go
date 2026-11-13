package service

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
)

var embeddedMediaURLPattern = regexp.MustCompile(`(?i)https?://[^\s"'<>]+`)

var mediaURLFieldNames = map[string]struct{}{
	"url":           {},
	"download_url":  {},
	"video_url":     {},
	"result_url":    {},
	"content_url":   {},
	"preview_url":   {},
	"thumbnail_url": {},
	"thumb_url":     {},
	"poster_url":    {},
	"file_url":      {},
}

// sanitizeMediaStatusResponseForClient rewrites every known media URL field to
// the API's own content endpoint and removes other external URLs from the JSON.
func sanitizeMediaStatusResponseForClient(body []byte, proxyURL string) []byte {
	if len(body) == 0 || !json.Valid(body) {
		return body
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return body
	}
	sanitized := sanitizeMediaJSONValue(value, "", strings.TrimSpace(proxyURL))
	encoded, err := json.Marshal(sanitized)
	if err != nil {
		return body
	}
	return encoded
}

func sanitizeMediaJSONValue(value any, key, proxyURL string) any {
	switch typed := value.(type) {
	case map[string]any:
		for childKey, child := range typed {
			typed[childKey] = sanitizeMediaJSONValue(child, childKey, proxyURL)
		}
		return typed
	case []any:
		for index := range typed {
			typed[index] = sanitizeMediaJSONValue(typed[index], key, proxyURL)
		}
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		lower := strings.ToLower(trimmed)
		if _, mediaField := mediaURLFieldNames[strings.ToLower(key)]; mediaField &&
			(strings.HasPrefix(lower, "http://") ||
				strings.HasPrefix(lower, "https://") ||
				strings.HasPrefix(lower, "/v1/videos/") ||
				strings.HasPrefix(lower, "/videos/")) {
			if proxyURL != "" {
				return proxyURL
			}
			return ""
		}
		if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
			return ""
		}
		return embeddedMediaURLPattern.ReplaceAllString(typed, "[redacted-url]")
	default:
		return value
	}
}
