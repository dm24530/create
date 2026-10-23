package service

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"
)

type cachedCanvasAdminOnly struct {
	value     bool
	expiresAt int64
}

var canvasAdminOnlyCache atomic.Value // *cachedCanvasAdminOnly
var canvasAdminOnlySF singleflight.Group

const (
	canvasAdminOnlyCacheTTL  = 60 * time.Second
	canvasAdminOnlyDBTimeout = 2 * time.Second
)

// IsCanvasAdminOnly reports whether the infinite canvas is still in
// administrator-only preview mode. Missing settings and read failures fail
// closed so a transient DB issue cannot expose an unreleased feature.
func (s *SettingService) IsCanvasAdminOnly(ctx context.Context) bool {
	if s == nil || s.settingRepo == nil {
		return true
	}
	if cached, ok := canvasAdminOnlyCache.Load().(*cachedCanvasAdminOnly); ok && cached != nil {
		if time.Now().UnixNano() < cached.expiresAt {
			return cached.value
		}
	}

	result, _, _ := canvasAdminOnlySF.Do("canvas_admin_only", func() (any, error) {
		if cached, ok := canvasAdminOnlyCache.Load().(*cachedCanvasAdminOnly); ok && cached != nil {
			if time.Now().UnixNano() < cached.expiresAt {
				return cached.value, nil
			}
		}
		dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), canvasAdminOnlyDBTimeout)
		defer cancel()
		value, err := s.settingRepo.GetValue(dbCtx, SettingKeyCanvasAdminOnly)
		if err != nil {
			if !errors.Is(err, ErrSettingNotFound) {
				slog.Warn("failed to get canvas_admin_only setting", "error", err)
			}
			canvasAdminOnlyCache.Store(&cachedCanvasAdminOnly{
				value:     true,
				expiresAt: time.Now().Add(canvasAdminOnlyCacheTTL).UnixNano(),
			})
			return true, nil
		}
		adminOnly := !isFalseSettingValue(value)
		canvasAdminOnlyCache.Store(&cachedCanvasAdminOnly{
			value:     adminOnly,
			expiresAt: time.Now().Add(canvasAdminOnlyCacheTTL).UnixNano(),
		})
		return adminOnly, nil
	})
	if value, ok := result.(bool); ok {
		return value
	}
	return true
}
