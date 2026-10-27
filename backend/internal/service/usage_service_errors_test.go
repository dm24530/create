//go:build unit

package service

import (
	"context"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/pkg/usagestats"
	"github.com/stretchr/testify/require"
)

type usageErrorMergeRepo struct {
	UsageLogRepository
	usageLogs  []UsageLog
	errorLogs  []UsageLog
	usageStats *usagestats.UsageStats
	errorCount int64
}

func (r *usageErrorMergeRepo) ListWithFilters(
	_ context.Context,
	params pagination.PaginationParams,
	_ usagestats.UsageLogFilters,
) ([]UsageLog, *pagination.PaginationResult, error) {
	return r.usageLogs, &pagination.PaginationResult{
		Total:    int64(len(r.usageLogs)),
		Page:     params.Page,
		PageSize: params.PageSize,
		Pages:    1,
	}, nil
}

func (r *usageErrorMergeRepo) ListUsageErrors(
	_ context.Context,
	params pagination.PaginationParams,
	_ usagestats.UsageLogFilters,
) ([]UsageLog, *pagination.PaginationResult, error) {
	return r.errorLogs, &pagination.PaginationResult{
		Total:    int64(len(r.errorLogs)),
		Page:     params.Page,
		PageSize: params.PageSize,
		Pages:    1,
	}, nil
}

func (r *usageErrorMergeRepo) GetStatsWithFilters(
	context.Context,
	usagestats.UsageLogFilters,
) (*usagestats.UsageStats, error) {
	return r.usageStats, nil
}

func (r *usageErrorMergeRepo) GetUsageErrorCount(
	context.Context,
	usagestats.UsageLogFilters,
) (int64, error) {
	return r.errorCount, nil
}

func TestUsageServiceListWithFiltersMergesFailedRequests(t *testing.T) {
	now := time.Now()
	repo := &usageErrorMergeRepo{
		usageLogs: []UsageLog{{
			ID:         1,
			RecordKind: "usage",
			Model:      "gpt-image-2",
			CreatedAt:  now.Add(-time.Minute),
		}},
		errorLogs: []UsageLog{{
			ID:         -2,
			RecordKind: "error",
			Model:      "gpt-image-2",
			CreatedAt:  now,
		}},
	}
	svc := NewUsageService(repo, nil, nil, nil)

	records, result, err := svc.ListWithFilters(
		context.Background(),
		pagination.PaginationParams{Page: 1, PageSize: 20, SortBy: "created_at", SortOrder: "desc"},
		usagestats.UsageLogFilters{IncludeErrors: true},
	)
	require.NoError(t, err)
	require.Equal(t, int64(2), result.Total)
	require.Len(t, records, 2)
	require.Equal(t, "error", records[0].RecordKind)
	require.Equal(t, "usage", records[1].RecordKind)
}

func TestUsageServiceGetStatsWithFiltersIncludesFailedRequests(t *testing.T) {
	repo := &usageErrorMergeRepo{
		usageStats: &usagestats.UsageStats{
			TotalRequests:     2,
			AverageDurationMs: 100,
		},
		errorCount: 1,
	}
	svc := NewUsageService(repo, nil, nil, nil)

	stats, err := svc.GetStatsWithFilters(
		context.Background(),
		usagestats.UsageLogFilters{IncludeErrors: true},
	)
	require.NoError(t, err)
	require.Equal(t, int64(3), stats.TotalRequests)
	require.InDelta(t, 100, stats.AverageDurationMs, 0.001)
}
