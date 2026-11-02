package service

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/tidwall/gjson"
)

type openAIImageOutputCounter struct {
	seen         map[string]struct{}
	seenSizes    map[string]string
	seenOrder    []string
	dataSizes    []string
	count        int
	maxDataCount int
}

func newOpenAIImageOutputCounter() *openAIImageOutputCounter {
	return &openAIImageOutputCounter{
		seen:      make(map[string]struct{}),
		seenSizes: make(map[string]string),
	}
}

func (c *openAIImageOutputCounter) Count() int {
	if c == nil {
		return 0
	}
	if c.maxDataCount > c.count {
		return c.maxDataCount
	}
	return c.count
}

func (c *openAIImageOutputCounter) Sizes() []string {
	if c == nil {
		return nil
	}
	sizes := make([]string, 0, len(c.seenOrder)+len(c.dataSizes))
	for _, key := range c.seenOrder {
		if size := strings.TrimSpace(c.seenSizes[key]); size != "" {
			sizes = append(sizes, size)
		}
	}
	if len(sizes) == 0 && len(c.dataSizes) > 0 {
		sizes = append(sizes, c.dataSizes...)
	}
	if len(sizes) == 0 {
		return nil
	}
	return sizes
}

func (c *openAIImageOutputCounter) AddJSONResponse(body []byte) {
	if c == nil || len(body) == 0 || !gjson.ValidBytes(body) {
		return
	}
	c.addDataArray(gjson.GetBytes(body, "data"))
	c.addOutputArray(gjson.GetBytes(body, "output"))
	c.addOutputArray(gjson.GetBytes(body, "response.output"))
}

func (c *openAIImageOutputCounter) AddSSEData(data []byte) {
	if c == nil || len(data) == 0 || strings.TrimSpace(string(data)) == "[DONE]" || !gjson.ValidBytes(data) {
		return
	}
	root := gjson.ParseBytes(data)
	c.addDataArray(root.Get("data"))
	eventType := strings.TrimSpace(root.Get("type").String())
	switch eventType {
	case "response.output_item.done":
		c.addImageOutputItem(root.Get("item"))
	case "response.completed", "response.done":
		c.addOutputArray(root.Get("response.output"))
	case "image_generation.completed", "image_edit.completed":
		if item := root.Get("item"); item.Exists() {
			c.addImageOutputItem(item)
			return
		}
		if output := root.Get("output"); output.Exists() {
			c.addImageOutputItem(output)
			return
		}
		c.addImageOutputItem(root)
	}
}

func (c *openAIImageOutputCounter) AddSSEBody(body string) {
	if c == nil || strings.TrimSpace(body) == "" {
		return
	}
	forEachOpenAISSEDataPayload(body, c.AddSSEData)
}

func (c *openAIImageOutputCounter) addDataArray(data gjson.Result) {
	if !data.IsArray() {
		return
	}
	items := data.Array()
	imageCount := 0
	sizes := make([]string, 0, len(items))
	for _, item := range items {
		if !item.IsObject() {
			continue
		}
		hasImageOutput := strings.TrimSpace(item.Get("url").String()) != "" ||
			strings.TrimSpace(item.Get("b64_json").String()) != ""
		if !hasImageOutput {
			continue
		}
		imageCount++
		if size := strings.TrimSpace(item.Get("size").String()); size != "" {
			sizes = append(sizes, size)
		}
	}
	if imageCount > c.maxDataCount {
		c.maxDataCount = imageCount
	}
	if len(sizes) > 0 {
		c.dataSizes = sizes
	}
}

func (c *openAIImageOutputCounter) addOutputArray(output gjson.Result) {
	if !output.IsArray() {
		return
	}
	output.ForEach(func(_, item gjson.Result) bool {
		c.addImageOutputItem(item)
		return true
	})
}

func (c *openAIImageOutputCounter) addImageOutputItem(item gjson.Result) {
	if !item.Exists() || !item.IsObject() {
		return
	}
	itemType := strings.TrimSpace(item.Get("type").String())
	if itemType != "" && itemType != "image_generation_call" && itemType != "image_generation.completed" && itemType != "image_edit.completed" {
		return
	}
	if strings.Contains(strings.ToLower(item.Raw), "partial_image") {
		return
	}
	result := strings.TrimSpace(item.Get("result").String())
	if result == "" {
		result = strings.TrimSpace(item.Get("b64_json").String())
	}
	if result == "" {
		result = strings.TrimSpace(item.Get("url").String())
	}
	if result == "" {
		return
	}
	key := strings.TrimSpace(item.Get("id").String())
	if key == "" {
		key = strings.TrimSpace(item.Get("call_id").String())
	}
	if key == "" {
		key = hashOpenAIImageOutputResult(result)
	}
	if key == "" {
		return
	}
	size := strings.TrimSpace(item.Get("size").String())
	if _, exists := c.seen[key]; exists {
		if size != "" && strings.TrimSpace(c.seenSizes[key]) == "" {
			c.seenSizes[key] = size
		}
		return
	}
	c.seen[key] = struct{}{}
	c.seenOrder = append(c.seenOrder, key)
	if size != "" {
		c.seenSizes[key] = size
	}
	c.count++
}

func hashOpenAIImageOutputResult(result string) string {
	result = strings.TrimSpace(result)
	if result == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(result))
	return hex.EncodeToString(sum[:])
}

func countOpenAIResponseImageOutputsFromJSONBytes(body []byte) int {
	counter := newOpenAIImageOutputCounter()
	counter.AddJSONResponse(body)
	return counter.Count()
}

func collectOpenAIResponseImageOutputSizesFromJSONBytes(body []byte) []string {
	counter := newOpenAIImageOutputCounter()
	counter.AddJSONResponse(body)
	return counter.Sizes()
}

func extractOpenAIImageOutputs(body []byte) []GeminiImageOutput {
	if len(body) > 0 && gjson.ValidBytes(body) {
		root := gjson.ParseBytes(body)
		for _, item := range root.Get("data").Array() {
			if output, ok := openAIImageOutputFromJSONValue(item); ok {
				return firstOpenAIImageOutput([]GeminiImageOutput{output})
			}
		}
		for _, path := range []string{"output", "response.output"} {
			for _, item := range root.Get(path).Array() {
				itemType := strings.TrimSpace(item.Get("type").String())
				if itemType != "" && itemType != "image_generation_call" && itemType != "image_generation.completed" && itemType != "image_edit.completed" {
					continue
				}
				if output, ok := openAIImageOutputFromJSONValue(item); ok {
					return firstOpenAIImageOutput([]GeminiImageOutput{output})
				}
			}
		}
	}

	pointers := collectOpenAIImagePointers(body)
	if len(pointers) == 0 {
		return nil
	}
	outputs := make([]GeminiImageOutput, 0, len(pointers))
	for _, pointer := range pointers {
		mimeType := strings.TrimSpace(pointer.MimeType)
		if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
			mimeType = openAIImageOutputMIMEType(pointer.OutputFormat)
		}
		if base64Data := normalizeOpenAIImageBase64(pointer.B64JSON); base64Data != "" {
			outputs = append(outputs, GeminiImageOutput{Base64: base64Data, MIMEType: mimeType})
			continue
		}
		rawURL := strings.TrimSpace(pointer.DownloadURL)
		if output, ok := geminiImageOutputFromDataURL(rawURL); ok {
			outputs = append(outputs, output)
			continue
		}
		if strings.HasPrefix(strings.ToLower(rawURL), "http://") || strings.HasPrefix(strings.ToLower(rawURL), "https://") {
			outputs = append(outputs, GeminiImageOutput{URL: rawURL, MIMEType: mimeType})
		}
	}
	return outputs
}

func openAIImageOutputFromJSONValue(item gjson.Result) (GeminiImageOutput, bool) {
	if !item.Exists() || !item.IsObject() {
		return GeminiImageOutput{}, false
	}
	mimeType := firstNonEmptyString(
		item.Get("mime_type").String(),
		item.Get("mimeType").String(),
		item.Get("content_type").String(),
	)
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		mimeType = openAIImageOutputMIMEType(item.Get("output_format").String())
	}
	for _, key := range []string{"b64_json", "base64", "image_base64"} {
		if base64Data := normalizeOpenAIImageBase64(item.Get(key).String()); base64Data != "" {
			return GeminiImageOutput{Base64: base64Data, MIMEType: mimeType}, true
		}
	}
	for _, key := range []string{"url", "download_url", "image_url", "result"} {
		rawURL := strings.TrimSpace(item.Get(key).String())
		if output, ok := geminiImageOutputFromDataURL(rawURL); ok {
			return output, true
		}
		if strings.HasPrefix(strings.ToLower(rawURL), "http://") || strings.HasPrefix(strings.ToLower(rawURL), "https://") {
			return GeminiImageOutput{URL: rawURL, MIMEType: mimeType}, true
		}
	}
	return GeminiImageOutput{}, false
}

func firstOpenAIImageOutput(outputs []GeminiImageOutput) []GeminiImageOutput {
	for _, output := range outputs {
		if strings.TrimSpace(output.Base64) != "" || strings.TrimSpace(output.URL) != "" {
			return []GeminiImageOutput{output}
		}
	}
	return nil
}

func openAIImageOutputsFromResponsesResults(results []openAIResponsesImageResult) []GeminiImageOutput {
	outputs := make([]GeminiImageOutput, 0, len(results))
	for _, result := range results {
		if base64Data := normalizeOpenAIImageBase64(result.Result); base64Data != "" {
			outputs = append(outputs, GeminiImageOutput{
				Base64:   base64Data,
				MIMEType: openAIImageOutputMIMEType(result.OutputFormat),
			})
			continue
		}
		if output, ok := geminiImageOutputFromDataURL(result.Result); ok {
			outputs = append(outputs, output)
			continue
		}
		if rawURL := strings.TrimSpace(result.Result); strings.HasPrefix(strings.ToLower(rawURL), "http://") || strings.HasPrefix(strings.ToLower(rawURL), "https://") {
			outputs = append(outputs, GeminiImageOutput{URL: rawURL, MIMEType: imageMIMETypeFromURL(rawURL)})
		}
	}
	return firstOpenAIImageOutput(outputs)
}

func geminiImageOutputFromDataURL(raw string) (GeminiImageOutput, bool) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(strings.ToLower(raw), "data:image/") {
		return GeminiImageOutput{}, false
	}
	comma := strings.Index(raw, ",")
	if comma < 0 || comma+1 >= len(raw) {
		return GeminiImageOutput{}, false
	}
	meta := strings.TrimSpace(raw[len("data:"):comma])
	parts := strings.Split(meta, ";")
	if len(parts) < 2 || !strings.EqualFold(strings.TrimSpace(parts[len(parts)-1]), "base64") {
		return GeminiImageOutput{}, false
	}
	mimeType := strings.TrimSpace(parts[0])
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return GeminiImageOutput{}, false
	}
	base64Data := normalizeOpenAIImageBase64(raw[comma+1:])
	if base64Data == "" {
		return GeminiImageOutput{}, false
	}
	return GeminiImageOutput{Base64: base64Data, MIMEType: mimeType}, true
}

func countOpenAIImageOutputsFromSSEBody(body string) int {
	counter := newOpenAIImageOutputCounter()
	counter.AddSSEBody(body)
	return counter.Count()
}

func collectOpenAIImageOutputSizesFromSSEBody(body string) []string {
	counter := newOpenAIImageOutputCounter()
	counter.AddSSEBody(body)
	return counter.Sizes()
}
