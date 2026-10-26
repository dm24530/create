//go:build integration

package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

func TestUsageBillingRepositoryApply_DeduplicatesBalanceBilling(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-user-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
		Balance:      100,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID: user.ID,
		Key:    "sk-usage-billing-" + uuid.NewString(),
		Name:   "billing",
		Quota:  1,
	})
	account := mustCreateAccount(t, client, &service.Account{
		Name: "usage-billing-account-" + uuid.NewString(),
		Type: service.AccountTypeAPIKey,
	})

	requestID := uuid.NewString()
	cmd := &service.UsageBillingCommand{
		RequestID:           requestID,
		APIKeyID:            apiKey.ID,
		UserID:              user.ID,
		AccountID:           account.ID,
		AccountType:         service.AccountTypeAPIKey,
		BalanceCost:         1.25,
		APIKeyQuotaCost:     1.25,
		APIKeyRateLimitCost: 1.25,
	}

	result1, err := repo.Apply(ctx, cmd)
	require.NoError(t, err)
	require.NotNil(t, result1)
	require.True(t, result1.Applied)
	require.True(t, result1.APIKeyQuotaExhausted)

	result2, err := repo.Apply(ctx, cmd)
	require.NoError(t, err)
	require.NotNil(t, result2)
	require.False(t, result2.Applied)

	var balance float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT balance FROM users WHERE id = $1", user.ID).Scan(&balance))
	require.InDelta(t, 98.75, balance, 0.000001)

	var quotaUsed float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT quota_used FROM api_keys WHERE id = $1", apiKey.ID).Scan(&quotaUsed))
	require.InDelta(t, 1.25, quotaUsed, 0.000001)

	var usage5h float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT usage_5h FROM api_keys WHERE id = $1", apiKey.ID).Scan(&usage5h))
	require.InDelta(t, 1.25, usage5h, 0.000001)

	var status string
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT status FROM api_keys WHERE id = $1", apiKey.ID).Scan(&status))
	require.Equal(t, service.StatusAPIKeyQuotaExhausted, status)

	var dedupCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM usage_billing_dedup WHERE request_id = $1 AND api_key_id = $2", requestID, apiKey.ID).Scan(&dedupCount))
	require.Equal(t, 1, dedupCount)
}

func TestUsageBillingRepositoryRefund_RestoresChargeExactlyOnce(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-refund-user-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
		Balance:      100,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID: user.ID,
		Key:    "sk-usage-billing-refund-" + uuid.NewString(),
		Name:   "billing-refund",
		Quota:  10,
	})

	requestID := "client:refund-" + uuid.NewString()
	requestInstanceID := "server-refund-" + uuid.NewString()
	cmd := &service.UsageBillingCommand{
		RequestID:           requestID,
		RequestInstanceID:   requestInstanceID,
		APIKeyID:            apiKey.ID,
		UserID:              user.ID,
		BalanceCost:         1.25,
		APIKeyQuotaCost:     1.25,
		APIKeyRateLimitCost: 1.25,
	}

	applied, err := repo.Apply(ctx, cmd)
	require.NoError(t, err)
	require.True(t, applied.Applied)

	wrongInstance, err := repo.(service.UsageBillingRefundRepository).Refund(ctx, &service.UsageBillingRefundCommand{
		RequestID:         requestID,
		RequestInstanceID: "different-server-request",
		APIKeyID:          apiKey.ID,
	})
	require.NoError(t, err)
	require.False(t, wrongInstance.Applied)
	require.False(t, wrongInstance.AlreadyRefunded)

	first, err := repo.(service.UsageBillingRefundRepository).Refund(ctx, &service.UsageBillingRefundCommand{
		RequestID:         requestID,
		RequestInstanceID: requestInstanceID,
		APIKeyID:          apiKey.ID,
		Reason:            "terminal_request_failed:upstream_error",
	})
	require.NoError(t, err)
	require.True(t, first.Applied)
	require.InDelta(t, 1.25, first.RefundedAmount, 1e-12)
	require.NotNil(t, first.RefundedAt)

	second, err := repo.(service.UsageBillingRefundRepository).Refund(ctx, &service.UsageBillingRefundCommand{
		RequestID:         requestID,
		RequestInstanceID: requestInstanceID,
		APIKeyID:          apiKey.ID,
	})
	require.NoError(t, err)
	require.True(t, second.AlreadyRefunded)
	require.InDelta(t, 1.25, second.RefundedAmount, 1e-12)

	var balance, quotaUsed, usage5h, usage1d, usage7d float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
		SELECT u.balance, k.quota_used, k.usage_5h, k.usage_1d, k.usage_7d
		FROM users u
		JOIN api_keys k ON k.user_id = u.id
		WHERE u.id = $1 AND k.id = $2
	`, user.ID, apiKey.ID).Scan(&balance, &quotaUsed, &usage5h, &usage1d, &usage7d))
	require.InDelta(t, 100, balance, 1e-12)
	require.InDelta(t, 0, quotaUsed, 1e-12)
	require.InDelta(t, 0, usage5h, 1e-12)
	require.InDelta(t, 0, usage1d, 1e-12)
	require.InDelta(t, 0, usage7d, 1e-12)

	var refundedAmount float64
	var refundedAt sql.NullTime
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
		SELECT refunded_amount, refunded_at
		FROM usage_billing_dedup
		WHERE request_id = $1 AND api_key_id = $2
	`, requestID, apiKey.ID).Scan(&refundedAmount, &refundedAt))
	require.InDelta(t, 1.25, refundedAmount, 1e-12)
	require.True(t, refundedAt.Valid)
}

func TestUsageBillingRepositoryRefund_ConcurrentCallsApplyOnce(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-refund-concurrent-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
		Balance:      100,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID: user.ID,
		Key:    "sk-usage-billing-refund-concurrent-" + uuid.NewString(),
		Name:   "billing-refund-concurrent",
	})
	requestID := "client:refund-concurrent-" + uuid.NewString()
	requestInstanceID := "server-refund-concurrent-" + uuid.NewString()
	applied, err := repo.Apply(ctx, &service.UsageBillingCommand{
		RequestID:         requestID,
		RequestInstanceID: requestInstanceID,
		APIKeyID:          apiKey.ID,
		UserID:            user.ID,
		BalanceCost:       1.25,
	})
	require.NoError(t, err)
	require.True(t, applied.Applied)

	const workers = 8
	var appliedCount atomic.Int64
	var alreadyRefundedCount atomic.Int64
	errCh := make(chan error, workers)
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			result, refundErr := repo.(service.UsageBillingRefundRepository).Refund(ctx, &service.UsageBillingRefundCommand{
				RequestID:         requestID,
				RequestInstanceID: requestInstanceID,
				APIKeyID:          apiKey.ID,
			})
			if refundErr != nil {
				errCh <- refundErr
				return
			}
			if result.Applied {
				appliedCount.Add(1)
			}
			if result.AlreadyRefunded {
				alreadyRefundedCount.Add(1)
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		require.NoError(t, err)
	}

	require.EqualValues(t, 1, appliedCount.Load())
	require.EqualValues(t, workers-1, alreadyRefundedCount.Load())
	var balance float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT balance FROM users WHERE id = $1", user.ID).Scan(&balance))
	require.InDelta(t, 100, balance, 1e-12)
}

func TestUsageBillingRepositoryApply_DeduplicatesSubscriptionBilling(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-sub-user-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
	})
	group := mustCreateGroup(t, client, &service.Group{
		Name:             "usage-billing-group-" + uuid.NewString(),
		Platform:         service.PlatformAnthropic,
		SubscriptionType: service.SubscriptionTypeSubscription,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID:  user.ID,
		GroupID: &group.ID,
		Key:     "sk-usage-billing-sub-" + uuid.NewString(),
		Name:    "billing-sub",
	})
	subscription := mustCreateSubscription(t, client, &service.UserSubscription{
		UserID:  user.ID,
		GroupID: group.ID,
	})

	requestID := uuid.NewString()
	requestInstanceID := "server-sub-refund-" + uuid.NewString()
	cmd := &service.UsageBillingCommand{
		RequestID:         requestID,
		RequestInstanceID: requestInstanceID,
		APIKeyID:          apiKey.ID,
		UserID:            user.ID,
		AccountID:         0,
		SubscriptionID:    &subscription.ID,
		SubscriptionCost:  2.5,
	}

	result1, err := repo.Apply(ctx, cmd)
	require.NoError(t, err)
	require.True(t, result1.Applied)

	result2, err := repo.Apply(ctx, cmd)
	require.NoError(t, err)
	require.False(t, result2.Applied)

	var dailyUsage float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT daily_usage_usd FROM user_subscriptions WHERE id = $1", subscription.ID).Scan(&dailyUsage))
	require.InDelta(t, 2.5, dailyUsage, 0.000001)

	refund, err := repo.(service.UsageBillingRefundRepository).Refund(ctx, &service.UsageBillingRefundCommand{
		RequestID:         requestID,
		RequestInstanceID: requestInstanceID,
		APIKeyID:          apiKey.ID,
	})
	require.NoError(t, err)
	require.True(t, refund.Applied)
	require.InDelta(t, 2.5, refund.RefundedAmount, 1e-12)

	var dailyUsageAfterRefund, weeklyUsageAfterRefund, monthlyUsageAfterRefund float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
		SELECT daily_usage_usd, weekly_usage_usd, monthly_usage_usd
		FROM user_subscriptions
		WHERE id = $1
	`, subscription.ID).Scan(
		&dailyUsageAfterRefund,
		&weeklyUsageAfterRefund,
		&monthlyUsageAfterRefund,
	))
	require.InDelta(t, 0, dailyUsageAfterRefund, 1e-12)
	require.InDelta(t, 0, weeklyUsageAfterRefund, 1e-12)
	require.InDelta(t, 0, monthlyUsageAfterRefund, 1e-12)
}

func TestUsageBillingRepositoryApply_RequestFingerprintConflict(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-conflict-user-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
		Balance:      100,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID: user.ID,
		Key:    "sk-usage-billing-conflict-" + uuid.NewString(),
		Name:   "billing-conflict",
	})

	requestID := uuid.NewString()
	_, err := repo.Apply(ctx, &service.UsageBillingCommand{
		RequestID:   requestID,
		APIKeyID:    apiKey.ID,
		UserID:      user.ID,
		BalanceCost: 1.25,
	})
	require.NoError(t, err)

	_, err = repo.Apply(ctx, &service.UsageBillingCommand{
		RequestID:   requestID,
		APIKeyID:    apiKey.ID,
		UserID:      user.ID,
		BalanceCost: 2.50,
	})
	require.ErrorIs(t, err, service.ErrUsageBillingRequestConflict)
}

func TestUsageBillingRepositoryApply_DeletedAPIKeyStillBillsBalance(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-deleted-key-user-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
		Balance:      100,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID:      user.ID,
		Key:         "sk-usage-billing-deleted-key-" + uuid.NewString(),
		Name:        "billing-deleted-key",
		Quota:       50,
		RateLimit5h: 50,
	})
	account := mustCreateAccount(t, client, &service.Account{
		Name: "usage-billing-deleted-key-account-" + uuid.NewString(),
		Type: service.AccountTypeAPIKey,
	})

	_, err := integrationDB.ExecContext(ctx, "UPDATE api_keys SET deleted_at = NOW() WHERE id = $1", apiKey.ID)
	require.NoError(t, err)

	requestID := uuid.NewString()
	result, err := repo.Apply(ctx, &service.UsageBillingCommand{
		RequestID:           requestID,
		APIKeyID:            apiKey.ID,
		UserID:              user.ID,
		AccountID:           account.ID,
		AccountType:         service.AccountTypeAPIKey,
		BalanceCost:         1.25,
		APIKeyQuotaCost:     1.25,
		APIKeyRateLimitCost: 1.25,
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	require.True(t, result.Applied)
	require.False(t, result.APIKeyQuotaExhausted)

	var balance float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT balance FROM users WHERE id = $1", user.ID).Scan(&balance))
	require.InDelta(t, 98.75, balance, 0.000001)

	var quotaUsed, usage5h float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT quota_used, usage_5h FROM api_keys WHERE id = $1", apiKey.ID).Scan(&quotaUsed, &usage5h))
	require.InDelta(t, 0, quotaUsed, 0.000001)
	require.InDelta(t, 0, usage5h, 0.000001)

	var dedupCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM usage_billing_dedup WHERE request_id = $1 AND api_key_id = $2", requestID, apiKey.ID).Scan(&dedupCount))
	require.Equal(t, 1, dedupCount)
}

func TestUsageBillingRepositoryApply_UpdatesAccountQuota(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-account-user-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID: user.ID,
		Key:    "sk-usage-billing-account-" + uuid.NewString(),
		Name:   "billing-account",
	})
	account := mustCreateAccount(t, client, &service.Account{
		Name: "usage-billing-account-quota-" + uuid.NewString(),
		Type: service.AccountTypeAPIKey,
		Extra: map[string]any{
			"quota_limit": 100.0,
		},
	})

	_, err := repo.Apply(ctx, &service.UsageBillingCommand{
		RequestID:        uuid.NewString(),
		APIKeyID:         apiKey.ID,
		UserID:           user.ID,
		AccountID:        account.ID,
		AccountType:      service.AccountTypeAPIKey,
		AccountQuotaCost: 3.5,
	})
	require.NoError(t, err)

	var quotaUsed float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT COALESCE((extra->>'quota_used')::numeric, 0) FROM accounts WHERE id = $1", account.ID).Scan(&quotaUsed))
	require.InDelta(t, 3.5, quotaUsed, 0.000001)
}

func TestUsageBillingRepositoryApply_EnqueuesSchedulerOutboxOnQuotaCrossing(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)

	newFixture := func(t *testing.T, extra map[string]any) (int64, int64) {
		t.Helper()
		user := mustCreateUser(t, client, &service.User{
			Email:        fmt.Sprintf("usage-billing-outbox-user-%d-%s@example.com", uniqueNano(), uuid.NewString()),
			PasswordHash: "hash",
		})
		apiKey := mustCreateApiKey(t, client, &service.APIKey{
			UserID: user.ID,
			Key:    "sk-usage-billing-outbox-" + uuid.NewString(),
			Name:   "billing-outbox",
		})
		account := mustCreateAccount(t, client, &service.Account{
			Name:  "usage-billing-outbox-" + uuid.NewString(),
			Type:  service.AccountTypeAPIKey,
			Extra: extra,
		})
		return apiKey.ID, account.ID
	}

	outboxCountFor := func(t *testing.T, accountID int64) int {
		t.Helper()
		var count int
		require.NoError(t, integrationDB.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM scheduler_outbox WHERE event_type = $1 AND account_id = $2",
			service.SchedulerOutboxEventAccountChanged, accountID,
		).Scan(&count))
		return count
	}

	t.Run("daily_first_crossing_enqueues", func(t *testing.T) {
		apiKeyID, accountID := newFixture(t, map[string]any{
			"quota_daily_limit": 10.0,
		})
		// 第一次低于日限额：不应入队 outbox
		_, err := repo.Apply(ctx, &service.UsageBillingCommand{
			RequestID:        uuid.NewString(),
			APIKeyID:         apiKeyID,
			AccountID:        accountID,
			AccountType:      service.AccountTypeAPIKey,
			AccountQuotaCost: 4,
		})
		require.NoError(t, err)
		require.Equal(t, 0, outboxCountFor(t, accountID), "below limit should not enqueue")

		// 第二次跨越日限额：应入队一次 outbox
		_, err = repo.Apply(ctx, &service.UsageBillingCommand{
			RequestID:        uuid.NewString(),
			APIKeyID:         apiKeyID,
			AccountID:        accountID,
			AccountType:      service.AccountTypeAPIKey,
			AccountQuotaCost: 8,
		})
		require.NoError(t, err)
		require.Equal(t, 1, outboxCountFor(t, accountID), "crossing daily limit should enqueue once")

		// 再次递增（已超）：不应重复入队
		_, err = repo.Apply(ctx, &service.UsageBillingCommand{
			RequestID:        uuid.NewString(),
			APIKeyID:         apiKeyID,
			AccountID:        accountID,
			AccountType:      service.AccountTypeAPIKey,
			AccountQuotaCost: 2,
		})
		require.NoError(t, err)
		require.Equal(t, 1, outboxCountFor(t, accountID), "subsequent increments beyond limit should not re-enqueue")
	})

	t.Run("weekly_first_crossing_enqueues", func(t *testing.T) {
		apiKeyID, accountID := newFixture(t, map[string]any{
			"quota_weekly_limit": 10.0,
		})
		_, err := repo.Apply(ctx, &service.UsageBillingCommand{
			RequestID:        uuid.NewString(),
			APIKeyID:         apiKeyID,
			AccountID:        accountID,
			AccountType:      service.AccountTypeAPIKey,
			AccountQuotaCost: 15, // 单次即跨越
		})
		require.NoError(t, err)
		require.Equal(t, 1, outboxCountFor(t, accountID), "single-shot crossing weekly limit should enqueue once")
	})
}

func TestDashboardAggregationRepositoryCleanupUsageBillingDedup_BatchDeletesOldRows(t *testing.T) {
	ctx := context.Background()
	repo := newDashboardAggregationRepositoryWithSQL(integrationDB)

	oldRequestID := "dedup-old-" + uuid.NewString()
	newRequestID := "dedup-new-" + uuid.NewString()
	oldCreatedAt := time.Now().UTC().AddDate(0, 0, -400)
	newCreatedAt := time.Now().UTC().Add(-time.Hour)

	_, err := integrationDB.ExecContext(ctx, `
		INSERT INTO usage_billing_dedup (request_id, api_key_id, request_fingerprint, created_at)
		VALUES ($1, 1, $2, $3), ($4, 1, $5, $6)
	`,
		oldRequestID, strings.Repeat("a", 64), oldCreatedAt,
		newRequestID, strings.Repeat("b", 64), newCreatedAt,
	)
	require.NoError(t, err)

	require.NoError(t, repo.CleanupUsageBillingDedup(ctx, time.Now().UTC().AddDate(0, 0, -365)))

	var oldCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM usage_billing_dedup WHERE request_id = $1", oldRequestID).Scan(&oldCount))
	require.Equal(t, 0, oldCount)

	var newCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM usage_billing_dedup WHERE request_id = $1", newRequestID).Scan(&newCount))
	require.Equal(t, 1, newCount)

	var archivedCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT COUNT(*) FROM usage_billing_dedup_archive WHERE request_id = $1", oldRequestID).Scan(&archivedCount))
	require.Equal(t, 1, archivedCount)
}

func TestUsageBillingRepositoryApply_DeduplicatesAgainstArchivedKey(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := NewUsageBillingRepository(client, integrationDB)
	aggRepo := newDashboardAggregationRepositoryWithSQL(integrationDB)

	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("usage-billing-archive-user-%d@example.com", uniqueNano()),
		PasswordHash: "hash",
		Balance:      100,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{
		UserID: user.ID,
		Key:    "sk-usage-billing-archive-" + uuid.NewString(),
		Name:   "billing-archive",
	})

	requestID := uuid.NewString()
	cmd := &service.UsageBillingCommand{
		RequestID:   requestID,
		APIKeyID:    apiKey.ID,
		UserID:      user.ID,
		BalanceCost: 1.25,
	}

	result1, err := repo.Apply(ctx, cmd)
	require.NoError(t, err)
	require.True(t, result1.Applied)

	_, err = integrationDB.ExecContext(ctx, `
		UPDATE usage_billing_dedup
		SET created_at = $1
		WHERE request_id = $2 AND api_key_id = $3
	`, time.Now().UTC().AddDate(0, 0, -400), requestID, apiKey.ID)
	require.NoError(t, err)
	require.NoError(t, aggRepo.CleanupUsageBillingDedup(ctx, time.Now().UTC().AddDate(0, 0, -365)))

	result2, err := repo.Apply(ctx, cmd)
	require.NoError(t, err)
	require.False(t, result2.Applied)

	var balance float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT balance FROM users WHERE id = $1", user.ID).Scan(&balance))
	require.InDelta(t, 98.75, balance, 0.000001)
}
