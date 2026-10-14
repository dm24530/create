package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/httpclient"
)

// 作品库的数据来自自家灵感站的 SSR 页面（它没有对外 JSON 接口）：
//   - /video-prompts 内嵌视频提示词（含 18 条带分镜图的精选 + 各家模型导入的长尾）
//   - /explore       内嵌图片灵感（提示词 + 作者 + 自己的 CDN 图）
//
// 解析结果按类型缓存成快照，抓不到时继续用上一份，页面不会突然空掉。
const (
	inspirationLibraryVideoEndpoint = "https://gen.nbility.ai/video-prompts"
	inspirationLibraryImageEndpoint = "https://gen.nbility.ai/explore"
	inspirationLibraryTTL           = 6 * time.Hour
	inspirationLibraryMaxBytes      = 8 << 20
	inspirationLibraryDefaultPage   = 24
	inspirationLibraryMaxPage       = 60
)

type InspirationLibraryItem struct {
	ID           string `json:"id"`
	Type         string `json:"type"` // video | image
	Title        string `json:"title"`
	Prompt       string `json:"prompt"`
	Model        string `json:"model"`
	Category     string `json:"category"`
	CoverURL     string `json:"cover_url"`    // 已换成本站代理路径
	SourceCover  string `json:"source_cover"` // 上游原始地址（排查用）
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	Duration     int    `json:"duration_seconds"`
	AspectRatio  string `json:"aspect_ratio"`
	Resolution   string `json:"resolution"`
	Likes        int    `json:"likes"`
	Views        int    `json:"views"`
	Author       string `json:"author"`
	AuthorHandle string `json:"author_handle"`
	SourceURL    string `json:"source_url"`
	HasCover     bool   `json:"has_cover"`
}

type InspirationLibraryResult struct {
	Items      []InspirationLibraryItem `json:"items"`
	Page       int                      `json:"page"`
	PageSize   int                      `json:"page_size"`
	HasMore    bool                     `json:"has_more"`
	Total      int                      `json:"total"`
	Models     []string                 `json:"models"`
	Categories []string                 `json:"categories"`
	FetchedAt  int64                    `json:"fetched_at"`
	Stale      bool                     `json:"stale"`
}

type InspirationLibraryQuery struct {
	Type     string
	Model    string
	Category string
	Keyword  string
	Page     int
	PageSize int
	Refresh  bool
}

type inspirationLibrarySnapshot struct {
	items     []InspirationLibraryItem
	fetchedAt time.Time
}

// InspirationLibraryService 拉取并缓存自家灵感站的作品库。
type InspirationLibraryService struct {
	// direct 用于站内可达的情况（自家站点通常直连最快最稳）；
	// proxied 只在直连失败时兜底，避免代理把大页面截断。
	direct  *http.Client
	proxied *http.Client

	mu        sync.Mutex
	snapshots map[string]inspirationLibrarySnapshot
}

func NewInspirationLibraryService(proxyURL string, allowDirectOnProxyError bool) *InspirationLibraryService {
	service := &InspirationLibraryService{
		direct:    &http.Client{Timeout: 60 * time.Second},
		snapshots: map[string]inspirationLibrarySnapshot{},
	}
	if strings.TrimSpace(proxyURL) == "" {
		return service
	}
	client, err := httpclient.GetClient(httpclient.Options{
		Timeout:  60 * time.Second,
		ProxyURL: proxyURL,
	})
	if err == nil {
		service.proxied = client
	} else if !allowDirectOnProxyError {
		// 代理配错且禁止回退直连时，连直连也不放行（与更新检查保持一致）。
		service.direct = nil
	}
	return service
}

// ProvideInspirationLibraryService 与在线灵感共用出网配置。
func ProvideInspirationLibraryService(cfg *config.Config) *InspirationLibraryService {
	if cfg == nil {
		return NewInspirationLibraryService("", true)
	}
	return NewInspirationLibraryService(cfg.Update.ProxyURL, cfg.Security.ProxyFallback.AllowDirectOnError)
}

func (s *InspirationLibraryService) Library(ctx context.Context, query InspirationLibraryQuery) (InspirationLibraryResult, error) {
	result := InspirationLibraryResult{}
	if s == nil || s.direct == nil {
		return result, fmt.Errorf("inspiration library source is unreachable: outbound client is unavailable")
	}
	mediaType := normalizeLibraryType(query.Type)
	pageSize := query.PageSize
	if pageSize <= 0 || pageSize > inspirationLibraryMaxPage {
		pageSize = inspirationLibraryDefaultPage
	}
	page := query.Page
	if page <= 0 {
		page = 1
	}

	snapshot, stale, err := s.snapshot(ctx, mediaType, query.Refresh)
	if err != nil {
		return result, err
	}

	items := filterLibraryItems(snapshot.items, query)
	result.Page = page
	result.PageSize = pageSize
	result.Total = len(items)
	result.FetchedAt = snapshot.fetchedAt.Unix()
	result.Stale = stale
	result.Models = distinctLibraryValues(snapshot.items, func(item InspirationLibraryItem) string { return item.Model })
	result.Categories = distinctLibraryValues(snapshot.items, func(item InspirationLibraryItem) string { return item.Category })

	start := (page - 1) * pageSize
	if start > len(items) {
		start = len(items)
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	result.Items = append([]InspirationLibraryItem{}, items[start:end]...)
	result.HasMore = end < len(items)
	return result, nil
}

// snapshot 返回某类型的快照：未过期直接用；过期才回源；回源失败沿用旧快照。
func (s *InspirationLibraryService) snapshot(
	ctx context.Context,
	mediaType string,
	force bool,
) (inspirationLibrarySnapshot, bool, error) {
	s.mu.Lock()
	cached, ok := s.snapshots[mediaType]
	s.mu.Unlock()
	if ok && !force && time.Since(cached.fetchedAt) < inspirationLibraryTTL {
		return cached, false, nil
	}

	items, err := s.fetch(ctx, mediaType)
	if err != nil {
		if ok {
			// 源暂时不可用：保留上一份，页面继续可用。
			return cached, true, nil
		}
		return inspirationLibrarySnapshot{}, false, err
	}
	fresh := inspirationLibrarySnapshot{items: items, fetchedAt: time.Now()}
	s.mu.Lock()
	s.snapshots[mediaType] = fresh
	s.mu.Unlock()
	return fresh, false, nil
}

func (s *InspirationLibraryService) fetch(ctx context.Context, mediaType string) ([]InspirationLibraryItem, error) {
	endpoint := inspirationLibraryVideoEndpoint
	if mediaType == "image" {
		endpoint = inspirationLibraryImageEndpoint
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build library request: %w", err)
	}
	resp, err := s.direct.Do(req)
	if err != nil && s.proxied != nil {
		// 直连不通（例如部署在无法直连的机房）时再走代理。
		retry, buildErr := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if buildErr == nil {
			resp, err = s.proxied.Do(retry)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("fetch library page: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("library page returned %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, inspirationLibraryMaxBytes))
	if err != nil {
		return nil, fmt.Errorf("read library page: %w", err)
	}
	html := string(body)
	if mediaType == "image" {
		return parseExploreLibrary(html), nil
	}
	return parseVideoPromptLibrary(html), nil
}

/* ------------------------------- 解析 ------------------------------- */

var (
	videoRecipeAnchor = regexp.MustCompile(`\{slug:"`)
	exploreItemAnchor = regexp.MustCompile(`\{id:\d+,externalId:"`)
)

// parseVideoPromptLibrary 从 SSR 序列化数据里取视频提示词条目。
// 结构：{slug:"...",title:"...",category:"...",prompt:"...",duration:N,aspectRatio:"...",...}
func parseVideoPromptLibrary(html string) []InspirationLibraryItem {
	segments := splitByAnchor(html, videoRecipeAnchor)
	items := make([]InspirationLibraryItem, 0, len(segments))
	for _, segment := range segments {
		slug := libraryString(segment, "slug")
		prompt := libraryString(segment, "prompt")
		if slug == "" || prompt == "" {
			continue
		}
		storyboard := libraryString(segment, "storyboardImage")
		cover := ""
		if storyboard != "" {
			cover = "https://gen.nbility.ai" + storyboard
		}
		items = append(items, InspirationLibraryItem{
			ID:          slug,
			Type:        "video",
			Title:       libraryString(segment, "title"),
			Prompt:      prompt,
			Model:       libraryString(segment, "modelFamily"),
			Category:    libraryString(segment, "category"),
			SourceCover: cover,
			CoverURL:    inspirationMediaProxyPath(cover),
			HasCover:    cover != "",
			Duration:    libraryInt(segment, "duration"),
			AspectRatio: libraryString(segment, "aspectRatio"),
			Resolution:  libraryString(segment, "resolution"),
			SourceURL:   "https://gen.nbility.ai/video-prompts/" + slug,
		})
	}
	return items
}

// parseExploreLibrary 解析图片灵感：带提示词、作者和自家 CDN 上的封面图。
func parseExploreLibrary(html string) []InspirationLibraryItem {
	segments := splitByAnchor(html, exploreItemAnchor)
	items := make([]InspirationLibraryItem, 0, len(segments))
	for _, segment := range segments {
		externalID := libraryString(segment, "externalId")
		prompt := libraryString(segment, "prompt")
		if externalID == "" || prompt == "" {
			continue
		}
		cover := libraryString(segment, "coverUrl")
		category := firstLibraryCategory(segment)
		items = append(items, InspirationLibraryItem{
			ID:           externalID,
			Type:         "image",
			Title:        libraryTitle(prompt),
			Prompt:       prompt,
			Model:        libraryString(segment, "model"),
			Category:     category,
			SourceCover:  cover,
			CoverURL:     inspirationMediaProxyPath(cover),
			HasCover:     cover != "",
			Width:        libraryInt(segment, "width"),
			Height:       libraryInt(segment, "height"),
			Likes:        libraryInt(segment, "likes"),
			Views:        libraryInt(segment, "views"),
			Author:       libraryString(segment, "authorName"),
			AuthorHandle: libraryString(segment, "authorHandle"),
			SourceURL:    libraryString(segment, "authorProfileUrl"),
		})
	}
	return items
}

// splitByAnchor 以锚点为界切出每个对象的文本片段，避免写一个完整的 JS 解析器。
func splitByAnchor(html string, anchor *regexp.Regexp) []string {
	indexes := anchor.FindAllStringIndex(html, -1)
	if len(indexes) == 0 {
		return nil
	}
	segments := make([]string, 0, len(indexes))
	for i, pair := range indexes {
		end := len(html)
		if i+1 < len(indexes) {
			end = indexes[i+1][0]
		}
		segments = append(segments, html[pair[0]:end])
	}
	return segments
}

// libraryString 取 "name:"字符串"" 的值，还原换行和引号转义。
func libraryString(segment, name string) string {
	pattern := regexp.MustCompile(`(?:^|[,{])` + regexp.QuoteMeta(name) + `:"((?:[^"\\]|\\.)*)"`)
	match := pattern.FindStringSubmatch(segment)
	if len(match) < 2 {
		return ""
	}
	value := strings.ReplaceAll(match[1], `\n`, "\n")
	value = strings.ReplaceAll(value, `\"`, `"`)
	return strings.TrimSpace(value)
}

func libraryInt(segment, name string) int {
	pattern := regexp.MustCompile(`(?:^|[,{])` + regexp.QuoteMeta(name) + `:(\d+)`)
	match := pattern.FindStringSubmatch(segment)
	if len(match) < 2 {
		return 0
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		return 0
	}
	return value
}

func firstLibraryCategory(segment string) string {
	pattern := regexp.MustCompile(`categories:\$R\[\d+\]=\[.*?title:"((?:[^"\\]|\\.)*)"`)
	match := pattern.FindStringSubmatch(segment)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

// libraryTitle 用提示词首行当标题：这类条目没有独立标题。
func libraryTitle(prompt string) string {
	line := strings.TrimSpace(strings.SplitN(prompt, "\n", 2)[0])
	runes := []rune(line)
	if len(runes) > 40 {
		return string(runes[:40])
	}
	if line == "" {
		return "图片灵感"
	}
	return line
}

/* ------------------------------ 过滤 ------------------------------ */

func filterLibraryItems(items []InspirationLibraryItem, query InspirationLibraryQuery) []InspirationLibraryItem {
	model := strings.ToLower(strings.TrimSpace(query.Model))
	category := strings.ToLower(strings.TrimSpace(query.Category))
	keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
	out := make([]InspirationLibraryItem, 0, len(items))
	for _, item := range items {
		if model != "" && model != "all" && strings.ToLower(item.Model) != model {
			continue
		}
		if category != "" && category != "all" && strings.ToLower(item.Category) != category {
			continue
		}
		if keyword != "" {
			haystack := strings.ToLower(item.Prompt + " " + item.Title + " " + item.Author + " " + item.Model)
			if !strings.Contains(haystack, keyword) {
				continue
			}
		}
		out = append(out, item)
	}
	return out
}

func distinctLibraryValues(items []InspirationLibraryItem, pick func(InspirationLibraryItem) string) []string {
	seen := map[string]struct{}{}
	values := make([]string, 0, 8)
	for _, item := range items {
		value := strings.TrimSpace(pick(item))
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		values = append(values, value)
	}
	return values
}

func normalizeLibraryType(mediaType string) string {
	if strings.EqualFold(strings.TrimSpace(mediaType), "image") {
		return "image"
	}
	return "video"
}
