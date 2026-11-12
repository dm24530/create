package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"strings"
	"time"

	"github.com/tidwall/gjson"
)

var ErrOpenAIImagesTaskStreamEmpty = errors.New("OpenAI image stream contained no completed image")

// OpenAIImagesTaskResultFromSSE converts the OpenAI Images SSE stream used by
// durable image tasks into the regular non-streaming Images JSON shape.
func OpenAIImagesTaskResultFromSSE(body []byte) (json.RawMessage, error) {
	var completed map[string]json.RawMessage
	var partial map[string]json.RawMessage
	var usage json.RawMessage
	var createdAt int64

	forEachOpenAISSEFrame(string(body), func(eventType string, data []byte) {
		if !gjson.ValidBytes(data) {
			return
		}
		root := gjson.ParseBytes(data)
		item, ok := openAIImagesTaskStreamItem(root)
		if !ok {
			return
		}
		if value := root.Get("created_at").Int(); value > 0 && createdAt == 0 {
			createdAt = value
		}
		if value := root.Get("created").Int(); value > 0 && createdAt == 0 {
			createdAt = value
		}
		if raw := root.Get("usage"); raw.Exists() {
			usage = json.RawMessage(raw.Raw)
		}
		if strings.HasSuffix(strings.TrimSpace(eventType), ".completed") {
			completed = item
			return
		}
		partial = item
	})

	item := completed
	if len(item) == 0 {
		item = partial
	}
	if len(item) == 0 {
		return nil, ErrOpenAIImagesTaskStreamEmpty
	}
	if createdAt <= 0 {
		createdAt = time.Now().UTC().Unix()
	}

	top := map[string]json.RawMessage{
		"created": encodedJSON(createdAt),
		"data":    encodedJSON([]map[string]json.RawMessage{item}),
	}
	if len(usage) > 0 {
		top["usage"] = usage
	}
	return json.Marshal(top)
}

// OpenAIImagesTaskPartialPreview converts one OpenAI Images partial-image SSE
// event into the regular Images JSON shape used by the polling API. The raw
// upstream base64 is replaced with a small browser-ready preview.
func OpenAIImagesTaskPartialPreview(eventType string, data []byte) (json.RawMessage, bool) {
	if !gjson.ValidBytes(data) {
		return nil, false
	}
	root := gjson.ParseBytes(data)
	eventType = strings.TrimSpace(eventType)
	if eventType == "" || !strings.HasSuffix(eventType, ".partial_image") {
		eventType = strings.TrimSpace(root.Get("type").String())
	}
	if !strings.HasSuffix(eventType, ".partial_image") {
		return nil, false
	}
	item, ok := openAIImagesTaskStreamItem(root)
	if !ok {
		return nil, false
	}
	previewURL, previewMIMEType := openAIImagesTaskPartialPreviewURL(item)
	if previewURL == "" {
		return nil, false
	}
	previewItem, err := cloneImageItem(item)
	if err != nil {
		return nil, false
	}
	previewItem["url"] = encodedJSON(previewURL)
	previewItem["preview_url"] = encodedJSON(previewURL)
	previewItem["preview_data_url"] = encodedJSON(previewURL)
	if previewMIMEType != "" {
		previewItem["mime_type"] = encodedJSON(previewMIMEType)
	}
	delete(previewItem, "b64_json")
	delete(previewItem, "display_url")
	delete(previewItem, "local_asset_id")
	delete(previewItem, "object_key")

	createdAt := root.Get("created_at").Int()
	if createdAt <= 0 {
		createdAt = root.Get("created").Int()
	}
	if createdAt <= 0 {
		createdAt = time.Now().UTC().Unix()
	}
	top := map[string]json.RawMessage{
		"created": encodedJSON(createdAt),
		"data":    encodedJSON([]map[string]json.RawMessage{previewItem}),
	}
	return encodedJSON(top), true
}

func openAIImagesTaskPartialPreviewURL(item map[string]json.RawMessage) (string, string) {
	if raw, ok := item["b64_json"]; ok {
		var encoded string
		if json.Unmarshal(raw, &encoded) == nil {
			encoded = normalizeOpenAIImageBase64(encoded)
			if encoded != "" {
				data, err := base64.StdEncoding.DecodeString(encoded)
				if err == nil {
					previewURL := buildPreviewDataURL(data)
					if previewURL != "" {
						openAIImagesTaskPartialPreviewDimensions(item, data)
						return previewURL, "image/jpeg"
					}
				}
			}
		}
	}
	if raw, ok := item["url"]; ok {
		var rawURL string
		if json.Unmarshal(raw, &rawURL) == nil {
			if output, ok := geminiImageOutputFromDataURL(rawURL); ok {
				data, err := base64.StdEncoding.DecodeString(normalizeOpenAIImageBase64(output.Base64))
				if err == nil {
					previewURL := buildPreviewDataURL(data)
					if previewURL != "" {
						openAIImagesTaskPartialPreviewDimensions(item, data)
						return previewURL, "image/jpeg"
					}
				}
			}
			if previewURL := safeBrowserPreviewURL(rawURL); previewURL != "" {
				return previewURL, ""
			}
		}
	}
	return "", ""
}

func openAIImagesTaskPartialPreviewDimensions(item map[string]json.RawMessage, data []byte) {
	if _, ok := item["width"]; ok {
		if _, ok := item["height"]; ok {
			return
		}
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return
	}
	item["width"] = encodedJSON(config.Width)
	item["height"] = encodedJSON(config.Height)
}

func openAIImagesTaskStreamItem(root gjson.Result) (map[string]json.RawMessage, bool) {
	output, ok := openAIImageOutputFromJSONValue(root)
	if !ok {
		if encoded := normalizeOpenAIImageBase64(root.Get("partial_image_b64").String()); encoded != "" {
			output = GeminiImageOutput{
				Base64:   encoded,
				MIMEType: openAIImageOutputMIMEType(root.Get("output_format").String()),
			}
			ok = true
		}
	}
	if !ok {
		return nil, false
	}
	item := make(map[string]json.RawMessage, 6)
	rawURL := firstNonEmptyString(
		root.Get("url").String(),
		root.Get("download_url").String(),
		root.Get("image_url").String(),
		root.Get("result").String(),
	)
	switch {
	case strings.HasPrefix(strings.ToLower(rawURL), "http://"),
		strings.HasPrefix(strings.ToLower(rawURL), "https://"),
		strings.HasPrefix(strings.ToLower(rawURL), "data:image/"):
		item["url"] = encodedJSON(rawURL)
	case output.Base64 != "":
		item["b64_json"] = encodedJSON(output.Base64)
	}
	if len(item) == 0 {
		return nil, false
	}
	if mimeType := strings.TrimSpace(output.MIMEType); mimeType != "" {
		item["mime_type"] = encodedJSON(mimeType)
	}
	for _, key := range []string{"revised_prompt", "width", "height", "output_format"} {
		if raw := root.Get(key); raw.Exists() {
			item[key] = json.RawMessage(raw.Raw)
		}
	}
	if _, ok := item["width"]; !ok {
		if width, height, ok := parseOpenAIImageStreamSize(root.Get("size").String()); ok {
			item["width"] = encodedJSON(width)
			item["height"] = encodedJSON(height)
		}
	}
	return item, true
}

func parseOpenAIImageStreamSize(value string) (int64, int64, bool) {
	left, right, ok := strings.Cut(strings.TrimSpace(value), "x")
	if !ok {
		return 0, 0, false
	}
	var width, height int64
	if _, err := fmt.Sscan(strings.TrimSpace(left), &width); err != nil {
		return 0, 0, false
	}
	if _, err := fmt.Sscan(strings.TrimSpace(right), &height); err != nil {
		return 0, 0, false
	}
	if width <= 0 || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}
