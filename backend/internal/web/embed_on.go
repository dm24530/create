//go:build embed

package web

import (
	"bytes"
	"compress/gzip"
	"context"
	"embed"
	"encoding/json"
	htmlpkg "html"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/andybalholm/brotli"
	"github.com/gin-gonic/gin"
)

const (
	// NonceHTMLPlaceholder is the placeholder for nonce in HTML script tags
	NonceHTMLPlaceholder = "__CSP_NONCE_VALUE__"
	// seoBlockStart/seoBlockEnd 包住 index.html 里的 SEO 标签，按请求路径整体替换。
	seoBlockStart = "<!--seo:start-->"
	seoBlockEnd   = "<!--seo:end-->"
	// seoBodyStart/seoBodyEnd 包住 noscript 里的可抓取正文，避免爬虫只看到空壳。
	seoBodyStart = "<!--seo-body:start-->"
	seoBodyEnd   = "<!--seo-body:end-->"
)

const (
	defaultSeoKeywords = "AI 视频生成,AI 图片生成,视频生成,图片生成,AI 视频与图片生成平台,AI 创作平台"
	defaultSeoAliases  = "libTV,LibTV,libtv,CreateAI"
)

const landingHeroPreload = `<link rel="preload" as="image" type="image/webp" href="/landing/hero-stars-1280.webp" imagesrcset="/landing/hero-stars-640.webp 640w, /landing/hero-stars-960.webp 960w, /landing/hero-stars-1280.webp 1280w, /landing/hero-stars-1920.webp 1920w, /landing/hero-stars-2560.webp 2560w" imagesizes="100vw" fetchpriority="high" data-landing-hero-preload />`

type routeSeoDoc struct {
	Title       string
	Description string
	Keywords    string
	Robots      string
	Aliases     []string
}

//go:embed all:dist
var frontendFS embed.FS

// PublicSettingsProvider is an interface to fetch public settings
type PublicSettingsProvider interface {
	GetPublicSettingsForInjection(ctx context.Context) (any, error)
}

// FrontendServer serves the embedded frontend with settings injection
type FrontendServer struct {
	distFS      fs.FS
	fileServer  http.Handler
	baseHTML    []byte
	cache       *HTMLCache
	settings    PublicSettingsProvider
	overrideDir string // local file override directory
}

type compressedEmbeddedAsset struct {
	body        []byte
	contentType string
}

var compressedStaticCache sync.Map

// NewFrontendServer creates a new frontend server with settings injection
func NewFrontendServer(settingsProvider PublicSettingsProvider) (*FrontendServer, error) {
	distFS, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		return nil, err
	}

	// Read base HTML once
	file, err := distFS.Open("index.html")
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()

	baseHTML, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}

	cache := NewHTMLCache()
	cache.SetBaseHTML(baseHTML)

	return &FrontendServer{
		distFS:      distFS,
		fileServer:  http.FileServer(http.FS(distFS)),
		baseHTML:    baseHTML,
		cache:       cache,
		settings:    settingsProvider,
		overrideDir: filepath.Join("data", "public"),
	}, nil
}

// InvalidateCache invalidates the HTML cache (call when settings change)
func (s *FrontendServer) InvalidateCache() {
	if s != nil && s.cache != nil {
		s.cache.Invalidate()
	}
}

// Middleware returns the Gin middleware handler
func (s *FrontendServer) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Skip API routes
		if shouldBypassEmbeddedFrontend(path) {
			c.Next()
			return
		}

		cleanPath := strings.TrimPrefix(path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		// The canvas is a separate Vite application mounted below /canvas-app.
		// Its client-side routes must fall back to the canvas index, not the
		// main Vue application's index.
		if isCanvasAppRequestPath(cleanPath) {
			if cleanPath == "canvas-app" || cleanPath == "canvas-app/" || !s.fileExists(cleanPath) {
				s.serveCanvasAppIndex(c)
				return
			}
			applyStaticAssetCacheHeaders(c.Writer.Header(), cleanPath)
			if s.tryServeCompressedStatic(c, cleanPath) {
				return
			}
			s.fileServer.ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}

		// For index.html or SPA routes, serve with injected settings
		if cleanPath == "index.html" || !s.fileExists(cleanPath) {
			s.serveIndexHTML(c)
			return
		}

		// Try local override first
		if s.tryServeOverride(c, cleanPath) {
			return
		}

		// sitemap.xml / robots.txt 需要按当前请求域名替换占位符
		if tryServeOriginAwareStatic(c, s.distFS, cleanPath) {
			return
		}

		// Serve static files normally (hashed assets get long-lived cache headers)
		applyStaticAssetCacheHeaders(c.Writer.Header(), cleanPath)
		if s.tryServeCompressedStatic(c, cleanPath) {
			return
		}
		s.fileServer.ServeHTTP(c.Writer, c.Request)
		c.Abort()
	}
}

func isCanvasAppRequestPath(cleanPath string) bool {
	return cleanPath == "canvas-app" || strings.HasPrefix(cleanPath, "canvas-app/")
}

func (s *FrontendServer) serveCanvasAppIndex(c *gin.Context) {
	content, err := fs.ReadFile(s.distFS, "canvas-app/index.html")
	if err != nil {
		c.Status(http.StatusNotFound)
		c.Abort()
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Data(http.StatusOK, "text/html; charset=utf-8", content)
	c.Abort()
}

func (s *FrontendServer) fileExists(path string) bool {
	file, err := s.distFS.Open(path)
	if err != nil {
		return false
	}
	_ = file.Close()
	return true
}

func (s *FrontendServer) tryServeCompressedStatic(c *gin.Context, cleanPath string) bool {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		return false
	}
	if c.Request.Header.Get("Range") != "" || !isCompressibleEmbeddedAssetPath(cleanPath) {
		return false
	}
	encoding := acceptedStaticEncoding(c.Request.Header.Get("Accept-Encoding"))
	if encoding == "" {
		return false
	}

	cacheKey := encoding + ":" + cleanPath
	if cached, ok := compressedStaticCache.Load(cacheKey); ok {
		writeCompressedStatic(c, encoding, cached.(*compressedEmbeddedAsset))
		return true
	}

	raw, err := fs.ReadFile(s.distFS, cleanPath)
	if err != nil || len(raw) < 1024 {
		return false
	}
	body, err := compressEmbeddedAsset(raw, encoding)
	if err != nil {
		return false
	}
	contentType := mime.TypeByExtension(filepath.Ext(cleanPath))
	if contentType == "" {
		contentType = http.DetectContentType(raw)
	}
	cached := &compressedEmbeddedAsset{body: body, contentType: contentType}
	actual, _ := compressedStaticCache.LoadOrStore(cacheKey, cached)
	writeCompressedStatic(c, encoding, actual.(*compressedEmbeddedAsset))
	return true
}

func writeCompressedStatic(c *gin.Context, encoding string, cached *compressedEmbeddedAsset) {
	c.Header("Content-Encoding", encoding)
	c.Header("Vary", "Accept-Encoding")
	c.Header("Content-Type", cached.contentType)
	c.Header("Content-Length", strconv.Itoa(len(cached.body)))
	c.Status(http.StatusOK)
	if c.Request.Method == http.MethodGet {
		_, _ = c.Writer.Write(cached.body)
	}
	c.Abort()
}

func acceptedStaticEncoding(header string) string {
	hasBrotli := false
	for _, part := range strings.Split(strings.ToLower(header), ",") {
		fields := strings.Split(part, ";")
		encoding := strings.TrimSpace(fields[0])
		quality := 1.0
		for _, parameter := range fields[1:] {
			keyValue := strings.SplitN(strings.TrimSpace(parameter), "=", 2)
			if len(keyValue) != 2 || keyValue[0] != "q" {
				continue
			}
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(keyValue[1]), 64); err == nil {
				quality = parsed
			}
		}
		if quality <= 0 {
			continue
		}
		if encoding == "gzip" {
			// Cloudflare Quick Tunnel can decode Brotli but currently strips it
			// from the client response. Prefer gzip so the compressed body
			// reaches the browser intact.
			return "gzip"
		}
		if encoding == "br" {
			hasBrotli = true
		}
	}
	if hasBrotli {
		return "br"
	}
	return ""
}

func isCompressibleEmbeddedAssetPath(cleanPath string) bool {
	switch strings.ToLower(filepath.Ext(cleanPath)) {
	case ".css", ".js", ".json", ".svg", ".xml":
		return true
	default:
		return false
	}
}

func compressEmbeddedAsset(raw []byte, encoding string) ([]byte, error) {
	var buf bytes.Buffer
	switch encoding {
	case "br":
		writer := brotli.NewWriterLevel(&buf, 4)
		if _, err := writer.Write(raw); err != nil {
			return nil, err
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
	case "gzip":
		writer, err := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
		if err != nil {
			return nil, err
		}
		if _, err := writer.Write(raw); err != nil {
			return nil, err
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
	default:
		return nil, fs.ErrInvalid
	}
	return buf.Bytes(), nil
}

// tryServeOverride checks if a local override file exists and serves it.
// Files in overrideDir take precedence over embedded files.
func (s *FrontendServer) tryServeOverride(c *gin.Context, cleanPath string) bool {
	if s.overrideDir == "" {
		return false
	}
	filePath := filepath.Join(s.overrideDir, filepath.Clean("/"+cleanPath))
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		return false
	}
	c.File(filePath)
	c.Abort()
	return true
}

func (s *FrontendServer) serveIndexHTML(c *gin.Context) {
	// Get nonce from context (generated by SecurityHeaders middleware)
	nonce := middleware.GetNonceFromContext(c)

	// Check cache first
	cached := s.cache.Get()
	if cached != nil {
		// Check If-None-Match for 304 response
		if match := c.GetHeader("If-None-Match"); match == cached.ETag {
			c.Status(http.StatusNotModified)
			c.Abort()
			return
		}

		// Replace nonce placeholder with actual nonce before serving
		content := replaceNoncePlaceholder(cached.Content, nonce)
		content = applyRouteSeo(content, requestOrigin(c), c.Request.URL.Path, cached.SiteName, cached.SiteSEOKeywords)
		content = applyLandingHeroPreload(content, c.Request.URL.Path)

		c.Header("ETag", cached.ETag)
		c.Header("Cache-Control", "no-cache") // Must revalidate
		c.Data(http.StatusOK, "text/html; charset=utf-8", content)
		c.Abort()
		return
	}

	// Cache miss - fetch settings and render
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	settings, err := s.settings.GetPublicSettingsForInjection(ctx)
	if err != nil {
		// Fallback: serve without settings injection, but still fill the SEO block from the
		// real request host so no other site's domain is ever advertised.
		c.Data(http.StatusOK, "text/html; charset=utf-8",
			applyRouteSeo(s.baseHTML, requestOrigin(c), c.Request.URL.Path, "", ""))
		c.Abort()
		return
	}

	settingsJSON, err := json.Marshal(settings)
	if err != nil {
		// Fallback: serve without settings injection, but still fill the SEO block from the
		// real request host so no other site's domain is ever advertised.
		c.Data(http.StatusOK, "text/html; charset=utf-8",
			applyRouteSeo(s.baseHTML, requestOrigin(c), c.Request.URL.Path, "", ""))
		c.Abort()
		return
	}

	rendered := s.injectSettings(settingsJSON)
	s.cache.Set(rendered, settingsJSON)

	// Replace nonce placeholder with actual nonce before serving
	content := replaceNoncePlaceholder(rendered, nonce)
	content = applyRouteSeo(
		content,
		requestOrigin(c),
		c.Request.URL.Path,
		siteNameFromSettingsJSON(settingsJSON),
		siteSEOKeywordsFromSettingsJSON(settingsJSON),
	)
	content = applyLandingHeroPreload(content, c.Request.URL.Path)

	cached = s.cache.Get()
	if cached != nil {
		c.Header("ETag", cached.ETag)
	}
	c.Header("Cache-Control", "no-cache")
	c.Data(http.StatusOK, "text/html; charset=utf-8", content)
	c.Abort()
}

func applyLandingHeroPreload(content []byte, requestPath string) []byte {
	if requestPath != "/" && requestPath != "/home" {
		return content
	}
	if bytes.Contains(content, []byte("data-landing-hero-preload")) {
		return content
	}
	replacement := append([]byte(landingHeroPreload), []byte("\n</head>")...)
	return bytes.Replace(content, []byte("</head>"), replacement, 1)
}

func (s *FrontendServer) injectSettings(settingsJSON []byte) []byte {
	// Create the script tag to inject with nonce placeholder
	// The placeholder will be replaced with actual nonce at request time
	script := []byte(`<script nonce="` + NonceHTMLPlaceholder + `">window.__APP_CONFIG__=` + string(settingsJSON) + `;</script>`)

	// Inject before </head>
	headClose := []byte("</head>")
	result := bytes.Replace(s.baseHTML, headClose, append(script, headClose...), 1)

	// Apply custom branding before the browser paints the static defaults.
	result = injectSiteTitle(result, settingsJSON)
	result = injectSiteFavicon(result, settingsJSON)

	return result
}

// injectSiteFavicon replaces the static favicon with a configured, browser-safe image URL.
func injectSiteFavicon(html, settingsJSON []byte) []byte {
	var cfg struct {
		SiteLogo string `json:"site_logo"`
	}
	if err := json.Unmarshal(settingsJSON, &cfg); err != nil {
		return html
	}

	logoURL := safeImageURL(cfg.SiteLogo)
	if logoURL == "" {
		return html
	}

	linkStart := bytes.Index(html, []byte(`<link rel="icon"`))
	if linkStart == -1 {
		return html
	}
	linkEndOffset := bytes.IndexByte(html[linkStart:], '>')
	if linkEndOffset == -1 {
		return html
	}
	linkEnd := linkStart + linkEndOffset + 1
	replacement := []byte(`<link rel="icon" href="` + htmlpkg.EscapeString(logoURL) + `" />`)

	var buf bytes.Buffer
	buf.Write(html[:linkStart])
	buf.Write(replacement)
	buf.Write(html[linkEnd:])
	return buf.Bytes()
}

func safeImageURL(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "/") && !strings.HasPrefix(trimmed, "//") {
		return trimmed
	}
	if strings.HasPrefix(strings.ToLower(trimmed), "data:image/") {
		return trimmed
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	return trimmed
}

// injectSiteTitle replaces the static <title> in HTML with the configured site name.
// This ensures the browser tab shows the correct title before JS executes.
func injectSiteTitle(html, settingsJSON []byte) []byte {
	var cfg struct {
		SiteName string `json:"site_name"`
	}
	if err := json.Unmarshal(settingsJSON, &cfg); err != nil || cfg.SiteName == "" {
		return html
	}

	// Find and replace the existing <title>...</title>
	titleStart := bytes.Index(html, []byte("<title>"))
	titleEnd := bytes.Index(html, []byte("</title>"))
	if titleStart == -1 || titleEnd == -1 || titleEnd <= titleStart {
		return html
	}

	newTitle := []byte("<title>" + htmlpkg.EscapeString(cfg.SiteName) + " - AI 视频与图片生成</title>")
	var buf bytes.Buffer
	buf.Write(html[:titleStart])
	buf.Write(newTitle)
	buf.Write(html[titleEnd+len("</title>"):])
	return buf.Bytes()
}

// replaceNoncePlaceholder replaces the nonce placeholder with actual nonce value
func replaceNoncePlaceholder(html []byte, nonce string) []byte {
	return bytes.ReplaceAll(html, []byte(NonceHTMLPlaceholder), []byte(nonce))
}

func normalizeSeoPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "/"
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	if len(trimmed) > 1 {
		trimmed = strings.TrimRight(trimmed, "/")
	}
	if trimmed == "" {
		return "/"
	}
	return trimmed
}

// resolveRouteSeoDoc 决定每个路径服务端直接输出的 title/description/robots。
// 只有公开页面允许收录；后台与登录后页面一律 noindex，避免被索引到空壳页。
func resolveRouteSeoDoc(path, siteName, siteSEOKeywords string) routeSeoDoc {
	name := strings.TrimSpace(siteName)
	if name == "" {
		name = "Create"
	}
	aliases := buildSEOAliases(name, siteSEOKeywords)
	titleBrand := buildSEOTitleBrand(name, aliases)
	introBrand := buildSEOBrandIntro(name, aliases)
	normalized := normalizeSeoPath(path)
	switch {
	case normalized == "/" || normalized == "/home":
		return routeSeoDoc{
			Title:       titleBrand + " - AI 视频与图片生成",
			Description: introBrand + " 是一个 AI 视频与图片生成平台，支持 AI 视频生成、AI 图片生成与作品管理。",
			Keywords:    buildSEOKeywordString(name, aliases, defaultSeoKeywords),
			Robots:      "index,follow",
			Aliases:     aliases,
		}
	case normalized == "/model-plaza":
		return routeSeoDoc{
			Title:       titleBrand + " - AI 模型广场与价格对比",
			Description: introBrand + " 模型广场可对比各类 AI 视频与图片生成模型的实时价格、计费方式与可用分组。",
			Keywords: buildSEOKeywordString(
				name,
				aliases,
				"AI 视频模型价格,AI 图片模型价格,视频生成模型价格,图片生成模型价格,AI 模型价格对比,AI 模型广场",
			),
			Robots:  "index,follow",
			Aliases: aliases,
		}
	case normalized == "/key-usage":
		return routeSeoDoc{
			Title:       titleBrand + " - API 密钥用量查询",
			Description: "按密钥、模型与时间范围查询 API 调用量与额度消耗明细。",
			Keywords:    buildSEOKeywordString(name, aliases, "API 密钥用量,API 额度查询,Token 用量"),
			Robots:      "index,follow",
			Aliases:     aliases,
		}
	case strings.HasPrefix(normalized, "/legal/"):
		return routeSeoDoc{
			Title:       titleBrand + " - 条款与政策",
			Description: introBrand + " 的服务条款、隐私政策与使用规范。",
			Keywords:    buildSEOKeywordString(name, aliases, defaultSeoKeywords),
			Robots:      "index,follow",
			Aliases:     aliases,
		}
	}
	return routeSeoDoc{
		Title:       titleBrand + " - AI 视频与图片生成",
		Description: introBrand + " 是一个 AI 视频与图片生成平台。",
		Keywords:    buildSEOKeywordString(name, aliases, defaultSeoKeywords),
		Robots:      "noindex,nofollow",
		Aliases:     aliases,
	}
}

func buildSEOAliases(siteName, rawKeywords string) []string {
	raw := strings.TrimSpace(rawKeywords)
	if raw == "" {
		raw = defaultSeoAliases
	}
	values := append([]string{siteName}, splitSEOValues(raw)...)
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func splitSEOValues(raw string) []string {
	return strings.FieldsFunc(raw, func(r rune) bool {
		switch r {
		case ',', '，', ';', '；', '\n', '\r', '\t':
			return true
		default:
			return false
		}
	})
}

func buildSEOTitleBrand(siteName string, aliases []string) string {
	for _, alias := range aliases[1:] {
		if !strings.EqualFold(alias, siteName) {
			return siteName + " / " + alias
		}
	}
	return siteName
}

func buildSEOBrandIntro(siteName string, aliases []string) string {
	for _, alias := range aliases[1:] {
		if !strings.EqualFold(alias, siteName) {
			return siteName + "（又称 " + alias + "）"
		}
	}
	return siteName
}

func buildSEOKeywordString(siteName string, aliases []string, base string) string {
	terms := append([]string{siteName}, aliases...)
	terms = append(terms, splitSEOValues(base)...)
	for _, alias := range aliases {
		terms = append(terms,
			alias+" AI",
			alias+" AI 视频生成",
			alias+" AI 图片生成",
			alias+" 视频生成",
			alias+" 图片生成",
			alias+" video generator",
			alias+" image generator",
		)
	}

	result := make([]string, 0, len(terms))
	seen := make(map[string]struct{}, len(terms))
	for _, term := range terms {
		trimmed := strings.TrimSpace(term)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, trimmed)
	}
	return strings.Join(result, ",")
}

// requestOrigin 依据可信反代头推导外部访问源，canonical/og:url 必须用真实域名。
func requestOrigin(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	host := strings.TrimSpace(c.Request.Host)
	if host == "" {
		return ""
	}
	scheme := ""
	if forwarded := c.GetHeader("X-Forwarded-Proto"); forwarded != "" {
		scheme = strings.ToLower(strings.TrimSpace(strings.Split(forwarded, ",")[0]))
	}
	if scheme != "http" && scheme != "https" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return scheme + "://" + strings.TrimRight(host, "/")
}

// siteOriginPlaceholder 是 sitemap.xml / robots.txt 里代表站点自身域名的占位符。
// 这两个文件是构建产物的一部分，构建时并不知道最终部署域名；服务端在返回前按当前
// 请求域名替换，于是同一个产物可以部署到任意域名，也不会把别的站点写进 canonical、
// 站点地图或 robots 的 Sitemap 行。
const siteOriginPlaceholder = "{{SITE_ORIGIN}}"

// originAwareStaticFiles 列出需要在返回前替换占位符的静态文件及其 Content-Type。
var originAwareStaticFiles = map[string]string{
	"sitemap.xml": "application/xml; charset=utf-8",
	"robots.txt":  "text/plain; charset=utf-8",
}

// tryServeOriginAwareStatic 处理 sitemap.xml / robots.txt：把占位符换成当前请求域名后返回。
// 文件里没有占位符（例如运维自行替换过内容）时返回 false，交回常规静态文件流程。
func tryServeOriginAwareStatic(c *gin.Context, distFS fs.FS, cleanPath string) bool {
	contentType, isOriginAware := originAwareStaticFiles[cleanPath]
	if !isOriginAware {
		return false
	}
	raw, err := fs.ReadFile(distFS, cleanPath)
	if err != nil || !bytes.Contains(raw, []byte(siteOriginPlaceholder)) {
		return false
	}
	body := bytes.ReplaceAll(raw, []byte(siteOriginPlaceholder), []byte(requestOrigin(c)))
	applyStaticAssetCacheHeaders(c.Writer.Header(), cleanPath)
	c.Data(http.StatusOK, contentType, body)
	c.Abort()
	return true
}

// applyRouteSeo 用当前请求对应的 SEO 标签与可抓取正文整体替换 index.html 里的标记区块。
func applyRouteSeo(html []byte, origin, path, siteName, siteSEOKeywords string) []byte {
	html = replaceMarkedBlock(
		html,
		seoBlockStart,
		seoBlockEnd,
		buildSeoBlock(origin, path, siteName, siteSEOKeywords),
	)
	return replaceMarkedBlock(
		html,
		seoBodyStart,
		seoBodyEnd,
		buildSeoBody(path, siteName, siteSEOKeywords),
	)
}

func replaceMarkedBlock(html []byte, startMarker, endMarker, replacement string) []byte {
	start := bytes.Index(html, []byte(startMarker))
	end := bytes.Index(html, []byte(endMarker))
	if start == -1 || end == -1 || end <= start {
		return html
	}
	var buf bytes.Buffer
	buf.Grow(len(html) + len(replacement))
	buf.Write(html[:start])
	buf.WriteString(replacement)
	buf.Write(html[end+len(endMarker):])
	return buf.Bytes()
}

func buildSeoBlock(origin, path, siteName, siteSEOKeywords string) string {
	doc := resolveRouteSeoDoc(path, siteName, siteSEOKeywords)
	canonicalPath := normalizeSeoPath(path)
	if canonicalPath == "/" {
		canonicalPath = "/home"
	}
	canonical := canonicalPath
	imageURL := "/logo.svg"
	if origin != "" {
		canonical = origin + canonicalPath
		imageURL = origin + "/logo.svg"
	}

	var b strings.Builder
	esc := htmlpkg.EscapeString
	writeTag := func(line string) {
		b.WriteString("    " + line + "\n")
	}
	writeMeta := func(attr, key, content string) {
		writeTag(`<meta ` + attr + `="` + key + `" content="` + esc(content) + `" />`)
	}

	writeTag("<title>" + esc(doc.Title) + "</title>")
	writeMeta("name", "description", doc.Description)
	writeMeta("name", "keywords", doc.Keywords)
	writeMeta("name", "robots", doc.Robots)
	writeMeta("name", "msvalidate.01", "B55F2646907C6E19E99891EF692EBBF8")
	applicationName := strings.TrimSpace(siteName)
	if applicationName == "" {
		applicationName = "Create"
	}
	writeMeta("name", "application-name", applicationName)
	writeMeta("name", "theme-color", "#14b8a6")
	writeTag(`<link rel="canonical" href="` + esc(canonical) + `" />`)
	writeMeta("property", "og:type", "website")
	writeMeta("property", "og:site_name", applicationName)
	writeMeta("property", "og:title", doc.Title)
	writeMeta("property", "og:description", doc.Description)
	writeMeta("property", "og:url", canonical)
	writeMeta("property", "og:image", imageURL)
	writeMeta("name", "twitter:card", "summary")
	writeMeta("name", "twitter:title", doc.Title)
	writeMeta("name", "twitter:description", doc.Description)
	b.WriteString(buildStructuredData(origin, canonical, applicationName, doc.Aliases))
	return b.String()
}

func buildSeoBody(path, siteName, siteSEOKeywords string) string {
	doc := resolveRouteSeoDoc(path, siteName, siteSEOKeywords)
	esc := htmlpkg.EscapeString
	var b strings.Builder
	b.WriteString("      <main>\n")
	b.WriteString("        <h1>" + esc(doc.Title) + "</h1>\n")
	b.WriteString("        <p>" + esc(doc.Description) + "</p>\n")
	b.WriteString("        <p>支持 AI 视频生成、AI 图片生成、模型价格对比与创作作品管理。</p>\n")
	b.WriteString("        <nav><a href=\"/home\">首页</a> · <a href=\"/model-plaza\">模型广场与价格</a></nav>\n")
	b.WriteString("      </main>")
	return b.String()
}

func buildStructuredData(origin, canonical, siteName string, aliases []string) string {
	name := strings.TrimSpace(siteName)
	if name == "" {
		name = "Create"
	}
	provider := map[string]any{"@type": "Organization", "name": name}
	website := map[string]any{"@type": "WebSite", "name": name, "url": canonical}
	if origin != "" {
		provider["url"] = origin + "/"
		provider["logo"] = origin + "/logo.svg"
	}
	if len(aliases) > 1 {
		alternateNames := append([]string(nil), aliases[1:]...)
		provider["alternateName"] = alternateNames
		website["alternateName"] = alternateNames
	}
	payload := map[string]any{
		"@context": "https://schema.org",
		"@graph": []map[string]any{
			provider,
			website,
			{
				"@type":       "Service",
				"name":        name + " AI 视频与图片生成服务",
				"serviceType": "AI video and image generation platform",
				"provider":    provider,
				"description": "支持 AI 视频生成、AI 图片生成与作品管理。",
			},
		},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return `    <script type="application/ld+json">` + string(encoded) + "</script>\n"
}

// ServeEmbeddedFrontend returns a middleware for serving embedded frontend
// This is the legacy function for backward compatibility when no settings provider is available
func ServeEmbeddedFrontend() gin.HandlerFunc {
	distFS, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		panic("failed to get dist subdirectory: " + err.Error())
	}
	fileServer := http.FileServer(http.FS(distFS))
	overrideDir := filepath.Join("data", "public")

	return func(c *gin.Context) {
		path := c.Request.URL.Path

		if shouldBypassEmbeddedFrontend(path) {
			c.Next()
			return
		}

		cleanPath := strings.TrimPrefix(path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		if file, err := distFS.Open(cleanPath); err == nil {
			_ = file.Close()
			// Try local override first
			if tryServeOverrideFile(c, overrideDir, cleanPath) {
				return
			}
			// sitemap.xml / robots.txt 需要按当前请求域名替换占位符
			if tryServeOriginAwareStatic(c, distFS, cleanPath) {
				return
			}
			applyStaticAssetCacheHeaders(c.Writer.Header(), cleanPath)
			fileServer.ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}

		serveIndexHTML(c, distFS)
	}
}

// tryServeOverrideFile is a standalone version of tryServeOverride for legacy usage.
func tryServeOverrideFile(c *gin.Context, overrideDir, cleanPath string) bool {
	if overrideDir == "" {
		return false
	}
	filePath := filepath.Join(overrideDir, filepath.Clean("/"+cleanPath))
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		return false
	}
	c.File(filePath)
	c.Abort()
	return true
}

func shouldBypassEmbeddedFrontend(path string) bool {
	trimmed := strings.TrimSpace(path)
	return strings.HasPrefix(trimmed, "/api/") ||
		strings.HasPrefix(trimmed, "/v1/") ||
		strings.HasPrefix(trimmed, "/v1beta/") ||
		strings.HasPrefix(trimmed, "/backend-api/") ||
		strings.HasPrefix(trimmed, "/antigravity/") ||
		strings.HasPrefix(trimmed, "/setup/") ||
		trimmed == "/health" ||
		trimmed == "/models" ||
		strings.HasPrefix(trimmed, "/models/") ||
		trimmed == "/responses" ||
		strings.HasPrefix(trimmed, "/responses/") ||
		strings.HasPrefix(trimmed, "/chat/completions") ||
		strings.HasPrefix(trimmed, "/embeddings") ||
		trimmed == "/messages/count_tokens" ||
		trimmed == "/alpha/search" ||
		trimmed == "/web_search" ||
		trimmed == "/x_search" ||
		trimmed == "/tts" ||
		trimmed == "/stt" ||
		trimmed == "/realtime" ||
		trimmed == "/custom-voices" ||
		strings.HasPrefix(trimmed, "/custom-voices/") ||
		trimmed == "/contents/generations/tasks" ||
		strings.HasPrefix(trimmed, "/contents/generations/tasks/") ||
		trimmed == "/v3/contents/generations/tasks" ||
		strings.HasPrefix(trimmed, "/v3/contents/generations/tasks/") ||
		strings.HasPrefix(trimmed, "/images/") ||
		trimmed == "/videos" ||
		trimmed == "/video/generations" ||
		strings.HasPrefix(trimmed, "/videos/")
}

func serveIndexHTML(c *gin.Context, fsys fs.FS) {
	file, err := fsys.Open("index.html")
	if err != nil {
		c.String(http.StatusNotFound, "Frontend not found")
		c.Abort()
		return
	}
	defer func() { _ = file.Close() }()

	content, err := io.ReadAll(file)
	if err != nil {
		c.String(http.StatusInternalServerError, "Failed to read index.html")
		c.Abort()
		return
	}

	c.Data(http.StatusOK, "text/html; charset=utf-8", content)
	c.Abort()
}

func HasEmbeddedFrontend() bool {
	_, err := frontendFS.ReadFile("dist/index.html")
	return err == nil
}
