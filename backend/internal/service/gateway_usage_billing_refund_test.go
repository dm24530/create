package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

type usageBillingRefundRepoStub struct {
	UsageBillingRepository
	cmd    *UsageBillingRefundCommand
	result *UsageBillingRefundResult
	err    error
}

func (s *usageBillingRefundRepoStub) Refund(_ context.Context, cmd *UsageBillingRefundCommand) (*UsageBillingRefundResult, error) {
	s.cmd = cmd
	return s.result, s.err
}

func TestGatewayServiceRefundUsageBillingDelegatesToRepository(t *testing.T) {
	repo := &usageBillingRefundRepoStub{
		result: &UsageBillingRefundResult{
			Applied:        true,
			UserID:         7,
			APIKeyID:       9,
			RefundedAmount: 0.25,
		},
	}
	svc := &GatewayService{usageBillingRepo: repo}

	result, err := svc.RefundUsageBilling(context.Background(), &UsageBillingRefundCommand{
		RequestID: " req-1 ",
		APIKeyID:  9,
		Reason:    "terminal_request_failed:upstream_error",
	})

	require.NoError(t, err)
	require.True(t, result.Applied)
	require.InDelta(t, 0.25, result.RefundedAmount, 1e-12)
	require.NotNil(t, repo.cmd)
	require.Equal(t, " req-1 ", repo.cmd.RequestID)
	require.Equal(t, int64(9), repo.cmd.APIKeyID)
}
