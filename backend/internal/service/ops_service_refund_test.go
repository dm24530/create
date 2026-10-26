package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOpsServiceRefundTerminalFailureUsesBillingIDAndRecordsOutcome(t *testing.T) {
	refundedAt := time.Now().UTC().Truncate(time.Second)
	billingRepo := &usageBillingRefundRepoStub{
		result: &UsageBillingRefundResult{
			Applied:        true,
			UserID:         42,
			APIKeyID:       9,
			RefundedAmount: 0.25,
			RefundedAt:     &refundedAt,
		},
	}
	var (
		markedRequestID string
		markedClientID  string
		markedAPIKeyID  int64
		markedAmount    float64
	)
	opsRepo := &opsRepoMock{
		MarkErrorRefundedFn: func(_ context.Context, requestID, clientRequestID string, apiKeyID int64, amount float64) error {
			markedRequestID = requestID
			markedClientID = clientRequestID
			markedAPIKeyID = apiKeyID
			markedAmount = amount
			return nil
		},
	}
	svc := &OpsService{
		opsRepo:        opsRepo,
		gatewayService: &GatewayService{usageBillingRepo: billingRepo},
	}
	entry := &OpsInsertErrorLogInput{
		RequestID:       "request-1",
		ClientRequestID: "client-1",
		APIKeyID:        int64Ptr(9),
		StatusCode:      502,
		ErrorType:       "upstream_error",
	}

	result := svc.RefundTerminalFailure(context.Background(), entry)

	require.NotNil(t, result)
	require.True(t, result.Applied)
	require.NotNil(t, billingRepo.cmd)
	require.Equal(t, "client:client-1", billingRepo.cmd.RequestID)
	require.Equal(t, "request-1", billingRepo.cmd.RequestInstanceID)
	require.Equal(t, int64(9), billingRepo.cmd.APIKeyID)
	require.Equal(t, "refunded", entry.RefundStatus)
	require.InDelta(t, 0.25, entry.RefundAmount, 1e-12)
	require.Equal(t, refundedAt, *entry.RefundedAt)
	require.Equal(t, "request-1", markedRequestID)
	require.Equal(t, "client-1", markedClientID)
	require.Equal(t, int64(9), markedAPIKeyID)
	require.InDelta(t, 0.25, markedAmount, 1e-12)
}

func TestOpsUsageRequestIDPreservesForcedAndPrefixedIDs(t *testing.T) {
	tests := []struct {
		name  string
		entry *OpsInsertErrorLogInput
		want  string
	}{
		{
			name:  "explicit usage id",
			entry: &OpsInsertErrorLogInput{UsageRequestID: "grok-video:task-1"},
			want:  "grok-video:task-1",
		},
		{
			name:  "client request wins",
			entry: &OpsInsertErrorLogInput{RequestID: "server-1", ClientRequestID: "client-1"},
			want:  "client:client-1",
		},
		{
			name:  "local fallback",
			entry: &OpsInsertErrorLogInput{RequestID: "server-1"},
			want:  "local:server-1",
		},
		{
			name:  "already prefixed",
			entry: &OpsInsertErrorLogInput{RequestID: "client:client-1"},
			want:  "client:client-1",
		},
		{
			name:  "generated ids are not refundable",
			entry: &OpsInsertErrorLogInput{UsageRequestID: "generated:random"},
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, opsUsageRequestID(tt.entry))
		})
	}
}

func TestShouldRetryTerminalRefundOnlyForBillableFailureClasses(t *testing.T) {
	require.True(t, shouldRetryTerminalRefund(&OpsInsertErrorLogInput{StatusCode: 502, ErrorType: "api_error"}))
	require.True(t, shouldRetryTerminalRefund(&OpsInsertErrorLogInput{StatusCode: 400, ErrorOwner: "provider"}))
	require.False(t, shouldRetryTerminalRefund(&OpsInsertErrorLogInput{StatusCode: 404, ErrorOwner: "client"}))
	require.False(t, shouldRetryTerminalRefund(&OpsInsertErrorLogInput{StatusCode: 429, IsBusinessLimited: true, ErrorType: "api_error"}))
}
