//go:build unit

package handler

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

type openAIImagesTerminalBalanceRepo struct {
	openAIImagesFailoverAccountRepo
}

func (openAIImagesTerminalBalanceRepo) SetModelRateLimit(context.Context, int64, string, time.Time, ...string) error {
	return nil
}

type openAIImagesTerminalBalanceUpstream struct {
	service.HTTPUpstream
	mu         sync.Mutex
	accountIDs []int64
}

func (u *openAIImagesTerminalBalanceUpstream) Do(_ *http.Request, _ string, accountID int64, _ int) (*http.Response, error) {
	u.mu.Lock()
	u.accountIDs = append(u.accountIDs, accountID)
	u.mu.Unlock()
	return &http.Response{
		StatusCode: http.StatusForbidden,
		Header: http.Header{
			"Content-Type": []string{"application/json"},
			"X-Request-Id": []string{"req-terminal-balance"},
		},
		Body: io.NopCloser(bytes.NewBufferString(
			`{"error":{"code":"insufficient_balance","message":"Insufficient balance"}}`,
		)),
	}, nil
}

func (u *openAIImagesTerminalBalanceUpstream) calls() []int64 {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]int64(nil), u.accountIDs...)
}

func TestOpenAIGatewayHandlerImages_InsufficientBalanceStopsAfterOneUpstreamCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	groupID := int64(3140)
	accounts := []service.Account{
		{
			ID:          1,
			Name:        "image-balance-account-1",
			Platform:    service.PlatformOpenAI,
			Type:        service.AccountTypeAPIKey,
			Status:      service.StatusActive,
			Schedulable: true,
			Credentials: map[string]any{"api_key": "key-1", "base_url": "https://images.example.test"},
		},
		{
			ID:          2,
			Name:        "image-balance-account-2",
			Platform:    service.PlatformOpenAI,
			Type:        service.AccountTypeAPIKey,
			Status:      service.StatusActive,
			Schedulable: true,
			Credentials: map[string]any{"api_key": "key-2", "base_url": "https://images.example.test"},
		},
	}
	accountRepo := openAIImagesTerminalBalanceRepo{
		openAIImagesFailoverAccountRepo: openAIImagesFailoverAccountRepo{accounts: accounts},
	}
	upstream := &openAIImagesTerminalBalanceUpstream{}
	cfg := &config.Config{RunMode: config.RunModeSimple}
	gatewayService := service.NewOpenAIGatewayService(
		accountRepo,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
		cfg,
		nil,
		nil,
		nil,
		nil,
		nil,
		upstream,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
	)
	billingService := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, cfg, nil)
	t.Cleanup(billingService.Stop)
	h := NewOpenAIGatewayHandler(
		gatewayService,
		service.NewConcurrencyService(nil),
		billingService,
		service.NewAPIKeyService(nil, nil, nil, nil, nil, nil, cfg),
		nil,
		nil,
		nil,
		nil,
		cfg,
	)

	body := []byte(`{"model":"gpt-image-1","prompt":"draw a cat"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{
		ID:      99,
		GroupID: &groupID,
		Group: &service.Group{
			ID:                   groupID,
			AllowImageGeneration: true,
		},
		User: &service.User{ID: 100},
	})
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 100})

	h.Images(c)

	require.Equal(t, []int64{1}, upstream.calls())
	require.Equal(t, http.StatusPaymentRequired, rec.Code, rec.Body.String())
	require.Equal(t, service.OpenAIImagesInsufficientBalanceCode, gjson.GetBytes(rec.Body.Bytes(), "error.code").String())
}
