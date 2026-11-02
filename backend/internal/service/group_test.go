//go:build unit

package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestConfiguredImageAccountStatsCost_UsesSizeBreakdown(t *testing.T) {
	cost1K := 0.05
	cost4K := 0.2
	group := &Group{
		ImageCostPrice1K: &cost1K,
		ImageCostPrice4K: &cost4K,
	}

	cost := configuredImageAccountStatsCost(
		group,
		nil,
		3,
		map[string]int{
			ImageBillingSize1K:        2,
			ImageBillingSize4K:        1,
			"image_cache_read_tokens": 999,
		},
	)

	require.NotNil(t, cost)
	require.InDelta(t, 0.3, *cost, 1e-12)
}

func TestConfiguredImageAccountStatsCost_AccountsForImagesMissingFromBreakdown(t *testing.T) {
	cost1K := 0.05
	cost4K := 0.2
	imageSize := ImageBillingSize4K
	group := &Group{
		ImageCostPrice1K: &cost1K,
		ImageCostPrice4K: &cost4K,
	}

	cost := configuredImageAccountStatsCost(
		group,
		&imageSize,
		2,
		map[string]int{ImageBillingSize1K: 1},
	)

	require.NotNil(t, cost)
	require.InDelta(t, 0.25, *cost, 1e-12)
}

func TestApplyConfiguredImageAccountStatsCost_SkipsTokenBilling(t *testing.T) {
	cost1K := 0.05
	imageSize := ImageBillingSize1K
	tokenMode := string(BillingModeToken)
	existing := 0.123
	usageLog := &UsageLog{
		ImageCount:       1,
		ImageSize:        &imageSize,
		BillingMode:      &tokenMode,
		AccountStatsCost: &existing,
	}

	applyConfiguredImageAccountStatsCost(usageLog, &Group{ImageCostPrice1K: &cost1K})

	require.NotNil(t, usageLog.AccountStatsCost)
	require.InDelta(t, existing, *usageLog.AccountStatsCost, 1e-12)
}

func TestApplyConfiguredImageAccountStatsCost_NormalizesFinalCostByAccountRate(t *testing.T) {
	cost1K := 0.05
	imageSize := ImageBillingSize1K
	imageMode := string(BillingModeImage)
	accountRate := 0.5
	usageLog := &UsageLog{
		ImageCount:            2,
		ImageSize:             &imageSize,
		BillingMode:           &imageMode,
		AccountRateMultiplier: &accountRate,
	}

	applyConfiguredImageAccountStatsCost(usageLog, &Group{ImageCostPrice1K: &cost1K})

	require.NotNil(t, usageLog.AccountStatsCost)
	require.InDelta(t, 0.2, *usageLog.AccountStatsCost, 1e-12)
	require.InDelta(t, 0.1, *usageLog.AccountStatsCost*accountRate, 1e-12)
}

// TestGroup_GetImagePrice_1K 测试 1K 尺寸返回正确价格
func TestGroup_GetImagePrice_1K(t *testing.T) {
	price := 0.10
	group := &Group{
		ImagePrice1K: &price,
	}

	result := group.GetImagePrice("1K")
	require.NotNil(t, result)
	require.InDelta(t, 0.10, *result, 0.0001)
}

// TestGroup_GetImagePrice_2K 测试 2K 尺寸返回正确价格
func TestGroup_GetImagePrice_2K(t *testing.T) {
	price := 0.15
	group := &Group{
		ImagePrice2K: &price,
	}

	result := group.GetImagePrice("2K")
	require.NotNil(t, result)
	require.InDelta(t, 0.15, *result, 0.0001)
}

// TestGroup_GetImagePrice_4K 测试 4K 尺寸返回正确价格
func TestGroup_GetImagePrice_4K(t *testing.T) {
	price := 0.30
	group := &Group{
		ImagePrice4K: &price,
	}

	result := group.GetImagePrice("4K")
	require.NotNil(t, result)
	require.InDelta(t, 0.30, *result, 0.0001)
}

// TestGroup_GetImagePrice_UnknownSize 测试未知尺寸回退 2K
func TestGroup_GetImagePrice_UnknownSize(t *testing.T) {
	price2K := 0.15
	group := &Group{
		ImagePrice2K: &price2K,
	}

	// 未知尺寸 "3K" 应该回退到 2K
	result := group.GetImagePrice("3K")
	require.NotNil(t, result)
	require.InDelta(t, 0.15, *result, 0.0001)

	// 空字符串也回退到 2K
	result = group.GetImagePrice("")
	require.NotNil(t, result)
	require.InDelta(t, 0.15, *result, 0.0001)
}

// TestGroup_GetImagePrice_NilValues 测试未配置时返回 nil
func TestGroup_GetImagePrice_NilValues(t *testing.T) {
	group := &Group{
		// 所有 ImagePrice 字段都是 nil
	}

	require.Nil(t, group.GetImagePrice("1K"))
	require.Nil(t, group.GetImagePrice("2K"))
	require.Nil(t, group.GetImagePrice("4K"))
	require.Nil(t, group.GetImagePrice("unknown"))
}

// TestGroup_GetImagePrice_PartialConfig 测试部分配置
func TestGroup_GetImagePrice_PartialConfig(t *testing.T) {
	price1K := 0.10
	group := &Group{
		ImagePrice1K: &price1K,
		// ImagePrice2K 和 ImagePrice4K 未配置
	}

	result := group.GetImagePrice("1K")
	require.NotNil(t, result)
	require.InDelta(t, 0.10, *result, 0.0001)

	// 2K 和 4K 返回 nil
	require.Nil(t, group.GetImagePrice("2K"))
	require.Nil(t, group.GetImagePrice("4K"))
}
