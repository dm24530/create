package routes

import (
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/gin-gonic/gin"
)

// canvasUsageCompatibility keeps older cached canvas bundles working while
// returning an unlimited quota. It never touches the database.
func canvasUsageCompatibility(c *gin.Context) {
	response.Success(c, gin.H{
		"canvas_usage": gin.H{
			"package_name":    "无限画布",
			"total_count":     0,
			"used_count":      0,
			"reserved_count":  0,
			"remaining_count": 0,
			"activated":       true,
			"unlimited":       true,
		},
	})
}
