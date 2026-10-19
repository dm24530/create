package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSummarizeRedeemCodeStats(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	expiredAt := now.Add(-time.Hour)
	validUntil := now.Add(time.Hour)
	codes := []RedeemCode{
		{Type: RedeemTypeBalance, Value: 10, Status: StatusUsed},
		{Type: RedeemTypeBalance, Value: 5, Status: StatusUnused, ExpiresAt: &validUntil},
		{Type: RedeemTypeConcurrency, Value: 2, Status: StatusUnused, ExpiresAt: &expiredAt},
		{Type: RedeemTypeSubscription, Value: 30, Status: StatusExpired},
	}

	stats := summarizeRedeemCodeStats(codes, now)

	require.Equal(t, 4, stats["total_codes"])
	require.Equal(t, 1, stats["active_codes"])
	require.Equal(t, 1, stats["used_codes"])
	require.Equal(t, 2, stats["expired_codes"])
	require.Equal(t, 10.0, stats["total_value_distributed"])
	require.Equal(t, map[string]int{
		RedeemTypeBalance:      2,
		RedeemTypeConcurrency:  1,
		RedeemTypeSubscription: 1,
	}, stats["by_type"])
}
