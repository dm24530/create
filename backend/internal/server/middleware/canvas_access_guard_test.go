//go:build unit

package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newCanvasSettingService(t *testing.T, adminOnly bool) *service.SettingService {
	t.Helper()
	repo := &bmSettingRepo{values: make(map[string]string)}
	svc := service.NewSettingService(repo, &config.Config{})
	require.NoError(t, svc.UpdateSettings(context.Background(), &service.SystemSettings{
		CanvasAdminOnly: adminOnly,
	}))
	return svc
}

func TestCanvasAdminOnlyGuard(t *testing.T) {
	tests := []struct {
		name       string
		nilService bool
		adminOnly  bool
		role       *string
		wantStatus int
	}{
		{name: "disabled_allows_user", adminOnly: false, role: stringPtr("user"), wantStatus: http.StatusOK},
		{name: "nil_service_allows_user", nilService: true, role: stringPtr("user"), wantStatus: http.StatusOK},
		{name: "preview_allows_admin", adminOnly: true, role: stringPtr("admin"), wantStatus: http.StatusOK},
		{name: "preview_blocks_user", adminOnly: true, role: stringPtr("user"), wantStatus: http.StatusForbidden},
		{name: "preview_blocks_missing_role", adminOnly: true, wantStatus: http.StatusForbidden},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			r := gin.New()
			if tc.role != nil {
				role := *tc.role
				r.Use(func(c *gin.Context) {
					c.Set(string(ContextKeyUserRole), role)
					c.Next()
				})
			}

			var svc *service.SettingService
			if !tc.nilService {
				svc = newCanvasSettingService(t, tc.adminOnly)
			}
			r.Use(CanvasAdminOnlyGuard(svc))
			r.GET("/test", func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"ok": true})
			})

			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/test", nil))
			require.Equal(t, tc.wantStatus, w.Code)
		})
	}
}
