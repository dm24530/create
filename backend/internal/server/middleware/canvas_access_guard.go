package middleware

import (
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

// CanvasAdminOnlyGuard keeps the Create in administrator-only preview
// until the operator explicitly opens it. It must run after JWT auth.
func CanvasAdminOnlyGuard(settingService *service.SettingService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if settingService == nil || !settingService.IsCanvasAdminOnly(c.Request.Context()) {
			c.Next()
			return
		}
		if role, ok := GetUserRoleFromContext(c); ok && role == service.RoleAdmin {
			c.Next()
			return
		}
		response.Forbidden(c, "Create is currently available to administrators only.")
		c.Abort()
	}
}
