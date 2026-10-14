package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/httpclient"
)

const (
	inspirationSourceEndpoint = "https://civitai.com/api/v1/images"
	inspirationCacheTTL       = 10 * time.Minute
	inspirationMaxItems       = 48
)

var allowedInspirationMediaHosts = map[string]struct{}{
	"image.civitai.com": {},
	"civitai.com":       {},
}

type OnlineInspirationItem struct {
	ID             string `json:"id"`
	MediaType      string `json:"media_type"`
	MediaURL       string `json:"media_url"`
	PosterURL      string `json:"poster_url"`
	Prompt         string `json:"prompt"`
	NegativePrompt string `json:"negative_prompt"`
	Model          string `json:"model"`
	Author         string `json:"author"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	Likes          int    `json:"likes"`
	SourceURL      string `json:"source_url"`
}

type inspirationCacheEntry struct {
	items    []OnlineInspirationItem
	cachedAt time.Time
}

type VideoInspirationService struct {
	client *http.Client

	mu    sync.Mutex
	cache map[string]inspirationCacheEntry
}

func NewVideoInspirationService(proxyURL string, allowDirectOnProxyError bool) *VideoInspirationService {
	client, err := httpclient.GetClient(httpclient.Options{
		Timeout:  20 * time.Second,
		ProxyURL: proxyURL,
	})
	if err != nil {
		if strings.TrimSpace(proxyURL) != "" && !allowDirectOnProxyError {
			client = nil
		} else {
			client = &http.Client{Timeout: 20 * time.Second}
		}
	}
	return &VideoInspirationService{client: client, cache: map[string]inspirationCacheEntry{}}
}

// ProvideVideoInspirationService 复用「更新检查」已经配好的出网代理：
// 灵感源在海外，服务器通常也需要走代理才能拉取。
func ProvideVideoInspirationService(cfg *config.Config) *VideoInspirationService {
	if cfg == nil {
		return NewVideoInspirationService("", true)
	}
	return NewVideoInspirationService(cfg.Update.ProxyURL, cfg.Security.ProxyFallback.AllowDirectOnError)
}

func (s *VideoInspirationService) Online(
	ctx context.Context,
	mediaType string,
	limit int,
	forceRefresh bool,
) ([]OnlineInspirationItem, error) {
	if s == nil || s.client == nil {
		return nil, fmt.Errorf("inspiration source is not reachable: outbound client is unavailable")
	}
	mediaType = normalizeInspirationMediaType(mediaType)
	if limit <= 0 || limit > inspirationMaxItems {
		limit = 24
	}

	if !forceRefresh {
		s.mu.Lock()
		if entry, ok := s.cache[mediaType]; ok && time.Since(entry.cachedAt) < inspirationCacheTTL {
			items := entry.items
			s.mu.Unlock()
			return items, nil
		}
		s.mu.Unlock()
	}

	items, err := s.fetch(ctx, mediaType, limit)
	if err != nil {
		s.mu.Lock()
		entry, ok := s.cache[mediaType]
		s.mu.Unlock()
		if ok {
			return entry.items, nil
		}
		return nil, err
	}

	s.mu.Lock()
	s.cache[mediaType] = inspirationCacheEntry{items: items, cachedAt: time.Now()}
	s.mu.Unlock()
	return items, nil
}

func (s *VideoInspirationService) fetch(ctx context.Context, mediaType string, limit int) ([]OnlineInspirationItem, error) {
	params := url.Values{}
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("nsfw", "None")
	params.Set("withMeta", "true")
	params.Set("type", mediaType)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, inspirationSourceEndpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("build inspiration request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch inspiration source: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("inspiration source returned %d", resp.StatusCode)
	}

	var payload struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode inspiration source: %w", err)
	}

	seen := map[string]struct{}{}
	out := make([]OnlineInspirationItem, 0, len(payload.Items))
	for _, raw := range payload.Items {
		item, ok := normalizeOnlineInspiration(raw)
		if !ok {
			continue
		}
		if _, dup := seen[item.ID]; dup {
			continue
		}
		seen[item.ID] = struct{}{}
		out = append(out, item)
	}
	return out, nil
}

type inspirationSourceItem struct {
	// 用 json.Number：解成 float64 会把 60183831 变成 6.0183831e+07，
	// 既毁掉 id 也毁掉"查看原作品"的链接。
	ID        json.Number `json:"id"`
	URL       string      `json:"url"`
	Type      string      `json:"type"`
	NSFW      bool        `json:"nsfw"`
	NSFWLevel string      `json:"nsfwLevel"`
	Width     int         `json:"width"`
	Height    int         `json:"height"`
	BaseModel string      `json:"baseModel"`
	Username  string      `json:"username"`
	Thumbnail struct {
		URL string `json:"url"`
	} `json:"thumbnail"`
	Stats struct {
		LikeCount int `json:"likeCount"`
	} `json:"stats"`
	Meta struct {
		Prompt         string `json:"prompt"`
		NegativePrompt string `json:"negativePrompt"`
	} `json:"meta"`
}

func normalizeOnlineInspiration(raw json.RawMessage) (OnlineInspirationItem, bool) {
	var source inspirationSourceItem
	if err := json.Unmarshal(raw, &source); err != nil {
		return OnlineInspirationItem{}, false
	}
	mediaURL := strings.TrimSpace(source.URL)
	prompt := strings.TrimSpace(source.Meta.Prompt)
	if mediaURL == "" || prompt == "" {
		return OnlineInspirationItem{}, false
	}
	if source.NSFW || (strings.TrimSpace(source.NSFWLevel) != "" && !strings.EqualFold(source.NSFWLevel, "None")) {
		return OnlineInspirationItem{}, false
	}
	id := strings.TrimSpace(source.ID.String())
	if id == "" || id == "0" {
		id = mediaURL
	}
	mediaType := "image"
	if strings.EqualFold(source.Type, "video") {
		mediaType = "video"
	}
	return OnlineInspirationItem{
		ID:             id,
		MediaType:      mediaType,
		MediaURL:       inspirationMediaProxyPath(mediaURL),
		PosterURL:      inspirationMediaProxyPath(strings.TrimSpace(source.Thumbnail.URL)),
		Prompt:         prompt,
		NegativePrompt: strings.TrimSpace(source.Meta.NegativePrompt),
		Model:          strings.TrimSpace(source.BaseModel),
		Author:         strings.TrimSpace(source.Username),
		Width:          source.Width,
		Height:         source.Height,
		Likes:          source.Stats.LikeCount,
		SourceURL:      "https://civitai.com/images/" + url.PathEscape(id),
	}, true
}

func inspirationMediaProxyPath(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	return "/api/v1/public/video-inspiration/media?u=" + url.QueryEscape(rawURL)
}

func (s *VideoInspirationService) FetchMedia(ctx context.Context, rawURL, rangeHeader string) (*http.Response, error) {
	if s == nil || s.client == nil {
		return nil, fmt.Errorf("inspiration media proxy is unavailable")
	}
	target, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("invalid media url")
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, fmt.Errorf("unsupported media scheme")
	}
	if _, ok := allowedInspirationMediaHosts[strings.ToLower(target.Hostname())]; !ok {
		return nil, fmt.Errorf("media host is not allowed")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build media request: %w", err)
	}
	if strings.TrimSpace(rangeHeader) != "" {
		req.Header.Set("Range", rangeHeader)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch media: %w", err)
	}
	return resp, nil
}

func normalizeInspirationMediaType(mediaType string) string {
	if strings.EqualFold(strings.TrimSpace(mediaType), "image") {
		return "image"
	}
	return "video"
}
