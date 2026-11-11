package service

import (
	"encoding/json"
	"errors"
	"fmt"
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

func openAIImagesTaskStreamItem(root gjson.Result) (map[string]json.RawMessage, bool) {
	output, ok := openAIImageOutputFromJSONValue(root)
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
