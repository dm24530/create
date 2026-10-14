package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"
)

// 灵感站/在线灵感的素材转存：配了对象存储就用自己桶里的长期地址，
// 没配就返回 false，由调用方回退到"代理转发"。
const inspirationMirrorTTL = 7 * 24 * time.Hour

type mirrorCacheEntry struct {
	url      string
	cachedAt time.Time
}

// MirrorRemoteImage 抓取远端图片并转存到对象存储，返回自己的长期地址。
// 未配置对象存储、抓取失败或内容不是图片时返回 ok=false，调用方走代理。
func (s *ImageStorageSettingService) MirrorRemoteImage(ctx context.Context, rawURL string) (string, bool) {
	rawURL = strings.TrimSpace(rawURL)
	if s == nil || rawURL == "" {
		return "", false
	}
	s.mirrorMu.Lock()
	if entry, ok := s.mirrorCache[rawURL]; ok && time.Since(entry.cachedAt) < inspirationMirrorTTL {
		s.mirrorMu.Unlock()
		return entry.url, true
	}
	s.mirrorMu.Unlock()

	// 用带缓存的 resolve 判断，避免每次图片请求都去查一次配置。
	uploader, enabled := s.resolve()
	if !enabled || uploader == nil || uploader.storage == nil {
		return "", false
	}
	data, contentType, err := uploader.download(ctx, rawURL)
	if err != nil || !strings.HasPrefix(contentType, "image/") {
		return "", false
	}

	// 键用远端地址的哈希：同一张图重复请求会落到同一个对象。
	sum := sha256.Sum256([]byte(rawURL))
	key := videoStoragePrefix + "inspiration/" + hex.EncodeToString(sum[:])[:24] + extensionForContentType(contentType)
	stored, err := uploader.storage.Save(ctx, key, contentType, data)
	if err != nil || strings.TrimSpace(stored) == "" {
		return "", false
	}

	s.mirrorMu.Lock()
	if s.mirrorCache == nil {
		s.mirrorCache = map[string]mirrorCacheEntry{}
	}
	s.mirrorCache[rawURL] = mirrorCacheEntry{url: stored, cachedAt: time.Now()}
	s.mirrorMu.Unlock()
	return stored, true
}
