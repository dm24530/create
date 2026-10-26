//go:build integration

package repository

import (
	"context"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestGetErrorLogByID_APIKeyPrefixAndUpstreamStatus(t *testing.T) {
	ctx := context.Background()
	_, _ = integrationDB.ExecContext(ctx, "TRUNCATE ops_error_logs RESTART IDENTITY CASCADE")
	repo := NewOpsRepository(integrationDB).(*opsRepository)

	var plainID int64
	err := integrationDB.QueryRowContext(ctx, `
		INSERT INTO ops_error_logs (
			error_phase, error_type, severity, status_code, created_at
		) VALUES (
			'upstream', 'upstream_error', 'error', 500, NOW()
		) RETURNING id`,
	).Scan(&plainID)
	require.NoError(t, err)

	plain, err := repo.GetErrorLogByID(ctx, plainID)
	require.NoError(t, err)
	require.Empty(t, plain.APIKeyPrefix)

	validID, err := repo.InsertErrorLog(ctx, &service.OpsInsertErrorLogInput{
		ErrorPhase:   "request",
		ErrorType:    "api_error",
		Severity:     "error",
		StatusCode:   402,
		CreatedAt:    time.Now(),
		APIKeyPrefix: "sk-valid",
	})
	require.NoError(t, err)

	valid, err := repo.GetErrorLogByID(ctx, validID)
	require.NoError(t, err)
	require.Equal(t, "sk-valid", valid.APIKeyPrefix)

	zero := 0
	credentialFailureID, err := repo.InsertErrorLog(ctx, &service.OpsInsertErrorLogInput{
		ErrorPhase:         "account_auth",
		ErrorType:          "upstream_error",
		Severity:           "error",
		StatusCode:         503,
		UpstreamStatusCode: &zero,
		CreatedAt:          time.Now(),
	})
	require.NoError(t, err)

	credentialFailure, err := repo.GetErrorLogByID(ctx, credentialFailureID)
	require.NoError(t, err)
	require.NotNil(t, credentialFailure.UpstreamStatusCode)
	require.Zero(t, *credentialFailure.UpstreamStatusCode)
}

func TestOpsErrorRefundFieldsPersistThroughInsertListAndDetail(t *testing.T) {
	ctx := context.Background()
	_, _ = integrationDB.ExecContext(ctx, "TRUNCATE ops_error_logs RESTART IDENTITY CASCADE")
	repo := NewOpsRepository(integrationDB).(*opsRepository)
	refundedAt := time.Now().UTC().Truncate(time.Second)

	id, err := repo.InsertErrorLog(ctx, &service.OpsInsertErrorLogInput{
		RequestID:    "refund-record-request",
		ErrorPhase:   "upstream",
		ErrorType:    "upstream_error",
		Severity:     "error",
		StatusCode:   502,
		CreatedAt:    time.Now(),
		RefundStatus: "refunded",
		RefundAmount: 0.125,
		RefundedAt:   &refundedAt,
	})
	require.NoError(t, err)

	list, err := repo.ListErrorLogs(ctx, &service.OpsErrorLogFilter{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Len(t, list.Errors, 1)
	require.Equal(t, "refunded", list.Errors[0].RefundStatus)
	require.InDelta(t, 0.125, list.Errors[0].RefundAmount, 1e-12)
	require.NotNil(t, list.Errors[0].RefundedAt)

	detail, err := repo.GetErrorLogByID(ctx, id)
	require.NoError(t, err)
	require.Equal(t, "refunded", detail.RefundStatus)
	require.InDelta(t, 0.125, detail.RefundAmount, 1e-12)
	require.NotNil(t, detail.RefundedAt)
}
