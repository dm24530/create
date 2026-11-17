package routes

import (
	"net/http"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/handler"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestPublicRoutesRegisterCreateClientRelease(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	v1 := router.Group("/api/v1")

	RegisterPublicRoutes(v1, &handler.Handlers{
		Setting: &handler.SettingHandler{},
	})

	registered := false
	for _, route := range router.Routes() {
		if route.Method == http.MethodGet && route.Path == "/api/v1/public/create-client-release" {
			registered = true
			break
		}
	}

	require.True(t, registered, "GET /api/v1/public/create-client-release should be registered")
}
