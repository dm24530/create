//go:build unit

package service

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeOnlineInspirationKeepsOnlyUsableItems(t *testing.T) {
	var payload struct {
		Items []json.RawMessage `json:"items"`
	}
	raw := `{"items":[
		{"id":1,"url":"https://image.civitai.com/a/clip.mp4","type":"video","nsfw":false,"nsfwLevel":"None","width":1080,"height":1920,"baseModel":"Illustrious","username":"someone","stats":{"likeCount":12},"thumbnail":{"url":"https://image.civitai.com/a/thumb.jpeg"},"meta":{"prompt":"镜头描述","negativePrompt":"blurry"}},
		{"id":2,"url":"https://image.civitai.com/b/clip.mp4","type":"video","nsfw":false,"nsfwLevel":"None","meta":{}},
		{"id":3,"url":"https://image.civitai.com/c/clip.mp4","type":"video","nsfw":true,"nsfwLevel":"Mature","meta":{"prompt":"不该出现的描述"}}
	]}`
	require.NoError(t, json.Unmarshal([]byte(raw), &payload))

	items := make([]OnlineInspirationItem, 0, len(payload.Items))
	for _, item := range payload.Items {
		normalized, ok := normalizeOnlineInspiration(item)
		if ok {
			items = append(items, normalized)
		}
	}

	// 没有提示词的和标注 NSFW 的都要被丢掉。
	require.Len(t, items, 1)
	// id 必须保持整数形态，不能被解成 6.0183831e+07 之类的科学计数法。
	require.Equal(t, "1", items[0].ID)
	require.Equal(t, "https://civitai.com/images/1", items[0].SourceURL)
	require.Equal(t, "镜头描述", items[0].Prompt)
	require.Equal(t, "blurry", items[0].NegativePrompt)
	require.Equal(t, "video", items[0].MediaType)
	require.Equal(t, 12, items[0].Likes)

	// 媒体一律换成走本站代理的相对路径，浏览器不需要能直连第三方。
	require.Equal(t, "/api/v1/public/video-inspiration/media?u="+url.QueryEscape("https://image.civitai.com/a/clip.mp4"), items[0].MediaURL)
	require.Equal(t, "/api/v1/public/video-inspiration/media?u="+url.QueryEscape("https://image.civitai.com/a/thumb.jpeg"), items[0].PosterURL)
}

// 媒体代理只允许回源到灵感源 CDN，否则就成了任意 URL 代理（SSRF）。
func TestFetchMediaRejectsHostsOutsideAllowlist(t *testing.T) {
	// 这个用例只关心主机白名单，对象存储镜像留空走代理转发分支。
	svc := NewVideoInspirationService("", true, nil)

	_, err := svc.FetchMedia(context.Background(), "http://127.0.0.1:8080/health", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not allowed")

	_, err = svc.FetchMedia(context.Background(), "file:///etc/passwd", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "unsupported media scheme")
}

type recordingInspirationMirror struct {
	calls []string
}

func (r *recordingInspirationMirror) MirrorRemoteImage(_ context.Context, rawURL string) (string, bool) {
	r.calls = append(r.calls, rawURL)
	return "https://cdn.example.com/mirrored.png", true
}

// 转存入口同样是免登录的：白名单必须挡在抓取之前，
// 否则配好对象存储后任何人都能借这台服务器抓任意地址并存进桶里。
func TestMirrorToStorageStaysInsideMediaAllowlist(t *testing.T) {
	mirror := &recordingInspirationMirror{}
	svc := NewVideoInspirationService("", true, mirror)

	for _, blocked := range []string{
		"http://127.0.0.1:8080/health",
		"http://169.254.169.254/latest/meta-data/",
		"file:///etc/passwd",
		"",
	} {
		target, ok := svc.MirrorToStorage(context.Background(), blocked)
		require.False(t, ok, "blocked url %q must not be mirrored", blocked)
		require.Empty(t, target)
	}
	require.Empty(t, mirror.calls)

	target, ok := svc.MirrorToStorage(context.Background(), "https://image.civitai.com/a/clip.mp4")
	require.True(t, ok)
	require.Equal(t, "https://cdn.example.com/mirrored.png", target)
	require.Equal(t, []string{"https://image.civitai.com/a/clip.mp4"}, mirror.calls)
}

func TestNormalizeInspirationMediaTypeDefaultsToVideo(t *testing.T) {
	require.Equal(t, "image", normalizeInspirationMediaType("IMAGE"))
	require.Equal(t, "video", normalizeInspirationMediaType(""))
	require.Equal(t, "video", normalizeInspirationMediaType("something-else"))
}

// 排序与时间范围要映射成灵感源认识的参数名，非法值回落而不是透传。
func TestInspirationSortAndPeriodMapping(t *testing.T) {
	require.Equal(t, "reactions", normalizeInspirationSort("REACTIONS"))
	require.Equal(t, "newest", normalizeInspirationSort(""))
	require.Equal(t, "newest", normalizeInspirationSort("weird"))
	require.Equal(t, "Most Reactions", inspirationSortParam("reactions"))
	require.Equal(t, "Newest", inspirationSortParam("newest"))

	require.Equal(t, "day", normalizeInspirationPeriod("DAY"))
	require.Equal(t, "week", normalizeInspirationPeriod(""))
	require.Equal(t, "week", normalizeInspirationPeriod("yesterday"))
	require.Equal(t, "Day", inspirationPeriodParam("day"))
	require.Equal(t, "Week", inspirationPeriodParam("week"))
	require.Equal(t, "Month", inspirationPeriodParam("month"))
	require.Equal(t, "AllTime", inspirationPeriodParam("all"))
}
