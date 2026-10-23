package service

import (
	"net/url"
	"path"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// geminiImageOutputCounterKey 是请求级内联图片计数器挂在 gin.Context 上的键。
const geminiImageOutputCounterKey = "gemini_image_output_counter"

// geminiImageOutputCounter 记录一次转发里 Gemini 上游真正回吐的内联图片数量。
//
// 取「单个 payload 内的最大值」而不是累加：Gemini 兼容上游的 SSE 分片可能是
// 累积式的（同一份内容在后续 chunk 里重复整段回来——本文件同目录的
// computeGeminiTextDelta 就是为此存在的），逐 chunk 累加会把同一张图算很多次。
// 计费上宁可少算不可多算，所以用 max 兜底：
//   - 非流式：整份响应体只观测一次，max 即真实张数；
//   - 累积式流：最后一个 chunk 含全部图片，max 仍是真实张数；
//   - 增量式流且多图分散在不同 chunk：会低估到 1，与改动前的模型名启发式同值，
//     不构成回退。
type geminiImageOutputCounter struct {
	count    int
	outputs  []GeminiImageOutput
	observed bool
}

type GeminiImageOutput struct {
	Base64   string
	MIMEType string
	URL      string
}

var geminiTextImageURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)

// beginGeminiImageOutputObservation 在每次 Forward 开头重置计数器。
// failover 会拿同一个 gin.Context 重跑转发，不重置就会把上一个账号的图数带进来。
func beginGeminiImageOutputObservation(c *gin.Context) *geminiImageOutputCounter {
	if c == nil {
		return nil
	}
	counter := &geminiImageOutputCounter{}
	c.Set(geminiImageOutputCounterKey, counter)
	return counter
}

func geminiImageOutputCounterFromContext(c *gin.Context) *geminiImageOutputCounter {
	if c == nil {
		return nil
	}
	value, ok := c.Get(geminiImageOutputCounterKey)
	if !ok {
		return nil
	}
	counter, _ := value.(*geminiImageOutputCounter)
	return counter
}

// observeGeminiImageOutputs 观测一段上游响应（整份或单个 chunk）里的内联图片。
// 调用点与 upstreamResponseModelObserver.ObserveGemini 一一对应——那里拿得到
// 解包后的上游响应体，这里需要的是同一份字节。
func observeGeminiImageOutputs(c *gin.Context, payload []byte) {
	counter := geminiImageOutputCounterFromContext(c)
	if counter == nil {
		return
	}
	if hasGeminiCandidates(payload) {
		counter.observed = true
	}
	outputs := ExtractGeminiImageOutputs(payload)
	if len(outputs) > counter.count {
		counter.count = len(outputs)
		counter.outputs = append([]GeminiImageOutput(nil), outputs...)
	}
}

func observedGeminiImageOutputs(c *gin.Context) int {
	counter := geminiImageOutputCounterFromContext(c)
	if counter == nil {
		return 0
	}
	return counter.count
}

func observedGeminiImageOutputList(c *gin.Context) []GeminiImageOutput {
	counter := geminiImageOutputCounterFromContext(c)
	if counter == nil || len(counter.outputs) == 0 {
		return nil
	}
	return append([]GeminiImageOutput(nil), counter.outputs...)
}

// resolveGeminiImageCount 决定本次请求按几张图计费。
//
// 优先用上游真正返回的内联图片数：走 GeminiMessagesCompatService 的账号多是
// API Key + 自定义模型映射，客户端请求名和上游模型名都可能是站长自取的别名
// （issue #5358 里的 nana-banana-2），isImageGenerationModel 的白名单必然判不出，
// 于是 ImageCount=0，calculateRecordUsageCost 整条按次计费分支不触发，
// 生图请求全部记 $0。
//
// 只有响应里数不出图时（例如上游用 fileData 引用而非 inlineData 回图，或聚合
// 函数丢掉了图片 part）才退回既有的模型名启发式，保证老行为不回退；这里额外
// 也认映射后的上游模型名，与 shouldSkipCodexPlanGatedImageModelCooldown 对
// requestedModel / modelKey 双取的口径一致。
func resolveGeminiImageCount(c *gin.Context, originalModel, mappedModel string) int {
	if observed := observedGeminiImageOutputs(c); observed > 0 {
		return observed
	}
	if counter := geminiImageOutputCounterFromContext(c); counter != nil && counter.observed {
		// A valid Gemini response with no usable image is not a successful image
		// generation. Do not fall back to the model-name heuristic just to bill it.
		return 0
	}
	if isImageGenerationModel(originalModel) || isImageGenerationModel(mappedModel) {
		return 1
	}
	return 0
}

func hasGeminiCandidates(payload []byte) bool {
	if len(payload) == 0 || !gjson.ValidBytes(payload) {
		return false
	}
	candidates := gjson.GetBytes(payload, "candidates")
	if !candidates.Exists() {
		candidates = gjson.GetBytes(payload, "response.candidates")
	}
	return candidates.IsArray()
}

// extractGeminiImageOutputs normalizes every image representation Gemini-
// compatible providers commonly return: inlineData, inline_data, fileData and
// image URLs embedded in text. One candidate normally represents one generated
// image, so inline data wins over duplicate file/text references for that
// candidate.
func ExtractGeminiImageOutputs(payload []byte) []GeminiImageOutput {
	if len(payload) == 0 || !gjson.ValidBytes(payload) {
		return nil
	}
	candidates := gjson.GetBytes(payload, "candidates")
	if !candidates.Exists() {
		candidates = gjson.GetBytes(payload, "response.candidates")
	}
	if !candidates.IsArray() {
		return nil
	}

	outputs := make([]GeminiImageOutput, 0)
	candidates.ForEach(func(_, candidate gjson.Result) bool {
		inline := make([]GeminiImageOutput, 0)
		files := make([]GeminiImageOutput, 0)
		urls := make([]GeminiImageOutput, 0)
		candidate.Get("content.parts").ForEach(func(_, part gjson.Result) bool {
			if output, ok := geminiInlineImageOutput(part); ok {
				inline = append(inline, output)
				return true
			}
			if output, ok := geminiFileImageOutput(part); ok {
				files = append(files, output)
				return true
			}
			if text := strings.TrimSpace(part.Get("text").String()); text != "" {
				for _, rawURL := range geminiTextImageURLPattern.FindAllString(text, -1) {
					rawURL = strings.TrimRight(rawURL, ".,);]")
					if looksLikeGeminiImageURL(rawURL) {
						urls = append(urls, GeminiImageOutput{URL: rawURL, MIMEType: imageMIMETypeFromURL(rawURL)})
					}
				}
			}
			return true
		})

		candidateOutputs := inline
		if len(candidateOutputs) == 0 {
			candidateOutputs = files
		}
		if len(candidateOutputs) == 0 {
			candidateOutputs = urls
		}
		seenURLs := make(map[string]struct{})
		for _, output := range candidateOutputs {
			if output.Base64 == "" {
				if _, exists := seenURLs[output.URL]; exists {
					continue
				}
				seenURLs[output.URL] = struct{}{}
			}
			outputs = append(outputs, output)
		}
		return true
	})
	return outputs
}

func geminiInlineImageOutput(part gjson.Result) (GeminiImageOutput, bool) {
	inline := part.Get("inlineData")
	if !inline.Exists() {
		inline = part.Get("inline_data")
	}
	if !inline.Exists() {
		return GeminiImageOutput{}, false
	}

	mimeType := inline.Get("mimeType")
	if !mimeType.Exists() {
		mimeType = inline.Get("mime_type")
	}
	if !isGeminiInlineImageMIMEType(strings.ToLower(strings.TrimSpace(mimeType.String()))) {
		return GeminiImageOutput{}, false
	}

	// 只认真的带上了 base64 数据的 part，空壳 part 不计费。
	data := strings.TrimSpace(inline.Get("data").String())
	if data == "" {
		return GeminiImageOutput{}, false
	}
	return GeminiImageOutput{Base64: data, MIMEType: strings.TrimSpace(mimeType.String())}, true
}

func geminiFileImageOutput(part gjson.Result) (GeminiImageOutput, bool) {
	file := part.Get("fileData")
	if !file.Exists() {
		file = part.Get("file_data")
	}
	if !file.Exists() {
		return GeminiImageOutput{}, false
	}
	uri := strings.TrimSpace(file.Get("fileUri").String())
	if uri == "" {
		uri = strings.TrimSpace(file.Get("file_uri").String())
	}
	if !looksLikeGeminiImageURL(uri) {
		return GeminiImageOutput{}, false
	}
	mimeType := strings.TrimSpace(file.Get("mimeType").String())
	if mimeType == "" {
		mimeType = strings.TrimSpace(file.Get("mime_type").String())
	}
	if mimeType == "" {
		mimeType = imageMIMETypeFromURL(uri)
	}
	return GeminiImageOutput{URL: uri, MIMEType: mimeType}, true
}

func looksLikeGeminiImageURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	switch strings.ToLower(path.Ext(parsed.Path)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif":
		return true
	}
	return strings.HasPrefix(strings.ToLower(parsed.Query().Get("format")), "image/")
}

func imageMIMETypeFromURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	switch strings.ToLower(path.Ext(parsed.Path)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".avif":
		return "image/avif"
	default:
		return ""
	}
}
