//go:build unit

package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	middleware "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSeedanceHandlerLifecycleAndOwnership(t *testing.T) {
	h, slots, bindings, upstream := newGrokMediaSlotHandler(t, false, false, service.PlatformOpenAI)
	var owner int64
	upstream.call = func(req *http.Request, id int64) (*http.Response, error) {
		body := `{"id":"task-ark","status":"queued"}`
		if req.Method == http.MethodPost {
			owner = id
		} else {
			require.Equal(t, owner, id)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
	}
	newContext := func(method string) (*gin.Context, *httptest.ResponseRecorder) {
		c, w := grokMediaSlotContext(context.Background(), method == http.MethodPost)
		key, _ := middleware.GetAPIKeyFromContext(c)
		key.Group.Platform = service.PlatformOpenAI
		body := ""
		if method == http.MethodPost {
			body = `{"model":"doubao-seedance","content":[{"type":"text","text":"waves"}]}`
		}
		c.Request = httptest.NewRequest(method, "/api/v3/contents/generations/tasks", strings.NewReader(body))
		c.Params = gin.Params{{Key: "task_id", Value: "task-ark"}}
		return c, w
	}
	c, w := newContext(http.MethodPost)
	h.SeedanceTasks(c)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Positive(t, owner)
	require.Len(t, bindings.pending, 1)
	slots.assertReleased(t)
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		c, w = newContext(method)
		h.SeedanceTasks(c)
		require.Equal(t, 200, w.Code, w.Body.String())
		slots.assertReleased(t)
	}
	for _, other := range []string{"user", "key", "group", "task", "provider"} {
		c, w = newContext(http.MethodGet)
		key, _ := middleware.GetAPIKeyFromContext(c)
		switch other {
		case "user":
			c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 11, Concurrency: 5})
		case "key":
			key.ID = 21
		case "group":
			group := int64(25)
			key.GroupID = &group
		case "task":
			c.Params = gin.Params{{Key: "task_id", Value: "other"}}
		case "provider":
			c.Params = gin.Params{{Key: "request_id", Value: "task-ark"}}
		}
		before := upstream.calls
		if other == "provider" {
			h.GrokVideoStatus(c)
		} else {
			h.SeedanceTasks(c)
		}
		require.Equal(t, 404, w.Code, other+": "+w.Body.String())
		require.Equal(t, before, upstream.calls)
		slots.assertReleased(t)
	}
	c, _ = newContext(http.MethodGet)
	key, _ := middleware.GetAPIKeyFromContext(c)
	subject, _ := middleware.GetAuthSubjectFromContext(c)
	result := &service.OpenAIForwardResult{Usage: service.OpenAIUsage{OutputTokens: 12345}, ResponseID: "seedance:task-ark"}
	for i := range 20 {
		billed := prepareSeedanceCompletionBilling(context.Background(), h, key, subject, result.ResponseID, result)
		if i == 0 {
			require.NotNil(t, billed)
			require.Equal(t, "doubao-seedance", billed.BillingModel)
			require.Equal(t, 12345, billed.Usage.OutputTokens)
			require.Zero(t, billed.VideoCount)
		} else {
			require.Nil(t, billed)
		}
	}
	require.Len(t, bindings.billed, 1)
}

func TestCompositeSeedanceVideoLookupUsesCreateSnapshot(t *testing.T) {
	h, slots, bindings, upstream := newGrokMediaSlotHandler(t, false, false, service.PlatformOpenAI)
	upstream.call = func(req *http.Request, id int64) (*http.Response, error) {
		require.Equal(t, int64(1), id)
		body := `{"id":"task-video","status":"queued"}`
		if req.Method == http.MethodGet {
			body = `{"id":"task-video","status":"completed","video":{"url":"https://cdn.example/video.mp4","duration":5}}`
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(body)),
		}, nil
	}

	createCtx, createWriter := grokMediaSlotContext(context.Background(), true)
	createKey, _ := middleware.GetAPIKeyFromContext(createCtx)
	createKey.Group.Platform = service.PlatformComposite
	createCtx.Request = httptest.NewRequest(
		http.MethodPost,
		"/v1/video/generations",
		strings.NewReader(`{"model":"seedance-2.5","prompt":"waves","duration":5,"resolution":"720p"}`),
	)
	createCtx.Request.Header.Set("Content-Type", "application/json")
	h.SeedanceVideoGeneration(createCtx)
	require.Equal(t, http.StatusOK, createWriter.Code, createWriter.Body.String())
	slots.assertReleased(t)

	var pending service.GrokVideoPendingBilling
	require.NoError(t, json.Unmarshal(bindings.pending["10:20:task-video"], &pending))
	require.Equal(t, "seedance_video", pending.Provider)
	require.Equal(t, service.PlatformOpenAI, pending.Platform)

	statusCtx, statusWriter := grokMediaSlotContext(context.Background(), false)
	statusKey, _ := middleware.GetAPIKeyFromContext(statusCtx)
	statusKey.Group.Platform = service.PlatformComposite
	statusCtx.Params = gin.Params{{Key: "request_id", Value: "task-video"}}
	require.Equal(t, "seedance_video", h.ResolveCompositeVideoLookupRoute(statusCtx, "task-video"))
	h.SeedanceVideoStatus(statusCtx)
	require.Equal(t, http.StatusOK, statusWriter.Code, statusWriter.Body.String())
	slots.assertReleased(t)
	require.Equal(t, 2, upstream.calls)
}

func TestCompositeSeedanceVideoLookupFallsBackToModel(t *testing.T) {
	h, _, _, _ := newGrokMediaSlotHandler(t, false, false, service.PlatformOpenAI)
	c, _ := grokMediaSlotContext(context.Background(), false)
	key, _ := middleware.GetAPIKeyFromContext(c)
	key.Group.Platform = service.PlatformComposite
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/missing?model=seedance-2.5", nil)
	require.Equal(t, "seedance_video", h.ResolveCompositeVideoLookupRoute(c, "missing"))
}

func TestCompositeSeedanceVideoLookupUsesLegacySnapshotModel(t *testing.T) {
	h, _, bindings, _ := newGrokMediaSlotHandler(t, false, false, service.PlatformOpenAI)
	bindings.pending = map[string][]byte{
		"10:20:legacy": []byte(`{"model":"seedance-2.5"}`),
	}
	c, _ := grokMediaSlotContext(context.Background(), false)
	key, _ := middleware.GetAPIKeyFromContext(c)
	key.Group.Platform = service.PlatformComposite
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/legacy", nil)
	require.Equal(t, "seedance_video", h.ResolveCompositeVideoLookupRoute(c, "legacy"))
}

func TestSeedancePerSecondBillingUsesCreateSnapshot(t *testing.T) {
	h, _, bindings, upstream := newGrokMediaSlotHandler(t, false, false, service.PlatformOpenAI)
	upstream.call = func(req *http.Request, _ int64) (*http.Response, error) {
		body := `{"id":"task-second","status":"succeeded","usage":{"completion_tokens":999}}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(body)),
		}, nil
	}

	perSecond := 0.5
	groupPricing := []service.ChannelModelPricing{{
		Models:      []string{"doubao-seedance"},
		BillingMode: service.BillingModeVideo,
		Intervals: []service.PricingInterval{{
			TierLabel:       service.VideoBillingResolution720P,
			PerRequestPrice: &perSecond,
		}},
	}}
	c, w := grokMediaSlotContext(context.Background(), true)
	key, _ := middleware.GetAPIKeyFromContext(c)
	key.Group.Platform = service.PlatformOpenAI
	key.Group.ModelPricing = groupPricing
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/v3/contents/generations/tasks",
		strings.NewReader(`{"model":"doubao-seedance","content":[{"type":"text","text":"waves"}],"duration":20,"resolution":"720p"}`),
	)
	c.Request.Header.Set("Content-Type", "application/json")

	h.SeedanceTasks(c)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, bindings.pending, 1)

	subject, _ := middleware.GetAuthSubjectFromContext(c)
	billed := prepareSeedanceCompletionBilling(
		context.Background(),
		h,
		key,
		subject,
		"seedance:task-second",
		&service.OpenAIForwardResult{
			ResponseID: "seedance:task-second",
			Usage:      service.OpenAIUsage{OutputTokens: 999},
		},
	)
	require.NotNil(t, billed)
	require.Equal(t, "doubao-seedance", billed.BillingModel)
	require.Equal(t, 1, billed.VideoCount)
	require.Equal(t, service.VideoBillingResolution720P, billed.VideoResolution)
	require.Equal(t, 20, billed.VideoDurationSeconds)
	require.Zero(t, billed.Usage.OutputTokens, "per-second billing must not also charge completion tokens")
	require.Equal(t, service.StableGrokVideoBillingRequestID("seedance:task-second"), billed.RequestID)

	repeated := prepareSeedanceCompletionBilling(
		context.Background(),
		h,
		key,
		subject,
		"seedance:task-second",
		&service.OpenAIForwardResult{Usage: service.OpenAIUsage{OutputTokens: 999}},
	)
	require.Nil(t, repeated)
}
