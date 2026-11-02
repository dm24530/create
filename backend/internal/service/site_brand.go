package service

import "strings"

const (
	defaultSiteName        = "Create"
	defaultSiteSubtitle    = "AI 视频与图片生成平台"
	defaultSiteSEOKeywords = "libTV,LibTV,libtv,CreateAI"
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

// normalizeSiteSEOKeywords keeps SEO aliases compact and deterministic so the
// same value can safely drive meta tags, sitemap-facing copy, and JSON-LD.
func normalizeSiteSEOKeywords(value string) string {
	return strings.Join(splitSiteSEOKeywords(value), ",")
}

func splitSiteSEOKeywords(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		switch r {
		case ',', '，', ';', '；', '\n', '\r', '\t':
			return true
		default:
			return false
		}
	})

	seen := make(map[string]struct{}, len(parts))
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}
