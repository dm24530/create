package service

import "strings"

const (
	defaultSiteName     = "Create"
	defaultSiteSubtitle = "AI 视频与图片生成平台"
)

// normalizeSiteName keeps legacy persisted values from surfacing the old brand
// while preserving an explicitly configured site name.
func normalizeSiteName(value string) string {
	trimmed := strings.TrimSpace(value)
	switch strings.ToLower(trimmed) {
	case "", "sub2api", "sub2 api", "sub2-api":
		return defaultSiteName
	default:
		return trimmed
	}
}
