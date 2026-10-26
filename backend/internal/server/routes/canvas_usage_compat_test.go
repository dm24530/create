package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCanvasUsageCompatibilityReturnsUnlimitedWithoutDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/user/canvas-usage", nil)

	canvasUsageCompatibility(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload struct {
		Data struct {
			CanvasUsage struct {
				Activated bool `json:"activated"`
				Unlimited bool `json:"unlimited"`
			} `json:"canvas_usage"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Data.CanvasUsage.Activated)
	require.True(t, payload.Data.CanvasUsage.Unlimited)
}
