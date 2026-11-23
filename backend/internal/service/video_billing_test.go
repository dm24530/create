package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCanonicalGrokImagineVideoPriceFamily(t *testing.T) {
	t.Parallel()
	require.Equal(t, VideoPriceFamilyGrokImagineVideo, CanonicalGrokImagineVideoPriceFamily("grok-imagine-video"))
	require.Equal(t, VideoPriceFamilyGrokImagineVideo15, CanonicalGrokImagineVideoPriceFamily("grok-imagine-video-1.5"))
	require.Equal(t, VideoPriceFamilyGrokImagineVideo15, CanonicalGrokImagineVideoPriceFamily("grok-imagine-video-1.5-preview"))
	require.Equal(t, VideoPriceFamilyGrokImagineVideo15, CanonicalGrokImagineVideoPriceFamily("xai/grok-video-1.5"))
	require.Equal(t, "grok-imagine-video-2", CanonicalGrokImagineVideoPriceFamily("grok-imagine-video-2"))
	require.Equal(t, "grok-imagine-video-2", CanonicalGrokImagineVideoPriceFamily("xai/grok-imagine-video-2"))
}

func TestNormalizeAndLookupVideoModelPrices(t *testing.T) {
	t.Parallel()
	raw := map[string]map[string]float64{
		"grok-imagine-video-1.5-preview": {"480p": 0.08, "720p": 0.14},
		"grok-imagine-video":             {"480p": 0.05},
		"grok-imagine-video-2":           {"1080p": 0.4},
	}
	norm := NormalizeVideoModelPrices(raw)
	require.NotNil(t, norm)
	require.Contains(t, norm, VideoPriceFamilyGrokImagineVideo15)
	require.Contains(t, norm, VideoPriceFamilyGrokImagineVideo)
	require.Contains(t, norm, "grok-imagine-video-2")

	p15 := LookupVideoModelPrice(norm, "grok-imagine-video-1.5", "480p")
	require.NotNil(t, p15)
	require.InDelta(t, 0.08, *p15, 1e-9)

	pBase := LookupVideoModelPrice(norm, "grok-imagine-video", "480p")
	require.NotNil(t, pBase)
	require.InDelta(t, 0.05, *pBase, 1e-9)
	// A missing model-specific tier must fall back to the flat tier price,
	// rather than borrowing another model-specific resolution.
	require.Nil(t, LookupVideoModelPrice(norm, "grok-imagine-video", "720p"))

	p2 := LookupVideoModelPrice(norm, "grok-imagine-video-2", "1080p")
	require.NotNil(t, p2)
	require.InDelta(t, 0.4, *p2, 1e-9)

	// Unmatched model → nil (caller falls back to flat columns / defaults).
	require.Nil(t, LookupVideoModelPrice(norm, "unknown-model", "480p"))
}

func TestNormalizeVideoModelPricesDropsUnknownResolutions(t *testing.T) {
	t.Parallel()
	// "4k" and "1080i" are not billable tiers. Collapsing them into 480p would
	// charge a 480p request at the operator's high-resolution price.
	norm := NormalizeVideoModelPrices(map[string]map[string]float64{
		"grok-imagine-video": {"480p": 0.05, "4k": 0.50, "1080i": 0.30},
	})
	require.NotNil(t, norm)
	require.Equal(t, map[string]float64{VideoBillingResolution480P: 0.05}, norm[VideoPriceFamilyGrokImagineVideo])

	// A model whose tiers are all unrecognized contributes no family at all.
	require.Nil(t, NormalizeVideoModelPrices(map[string]map[string]float64{
		"grok-imagine-video": {"4k": 0.50},
	}))
}

func TestNormalizeVideoModelPricesIsDeterministicAcrossAliasConflicts(t *testing.T) {
	t.Parallel()
	// Both keys canonicalize onto grok-imagine-video-1.5 and disagree on 480p.
	// Whichever price wins, it must be the same one on every run — a Go map walk
	// would let two processes bill the same request differently.
	raw := map[string]map[string]float64{
		"grok-imagine-video-1.5":         {"480p": 0.08},
		"grok-imagine-video-1.5-preview": {"480p": 0.11},
		"grok-video-1.5":                 {"480p": 0.09},
	}
	first := NormalizeVideoModelPrices(raw)
	require.NotNil(t, first)
	for i := 0; i < 50; i++ {
		require.Equal(t, first, NormalizeVideoModelPrices(raw), "run %d diverged", i)
	}

	// Aliases within one model key normalize to the same tier deterministically too.
	aliased := map[string]map[string]float64{
		"grok-imagine-video": {"720": 0.12, "720p": 0.13, "hd": 0.14},
	}
	firstAliased := NormalizeVideoModelPrices(aliased)
	require.NotNil(t, firstAliased)
	for i := 0; i < 50; i++ {
		require.Equal(t, firstAliased, NormalizeVideoModelPrices(aliased), "run %d diverged", i)
	}
}

func TestLookupVideoBillingResolutionReportsUnknownTiers(t *testing.T) {
	t.Parallel()
	for _, in := range []string{"480", "480p", "SD", "720", "hd", "1080", "full-hd", " fhd "} {
		normalized, ok := LookupVideoBillingResolution(in)
		require.True(t, ok, "input=%q", in)
		require.NotEmpty(t, normalized)
	}
	for _, in := range []string{"", "4k", "1080i", "2160p", "potato"} {
		normalized, ok := LookupVideoBillingResolution(in)
		require.False(t, ok, "input=%q", in)
		require.Empty(t, normalized)
	}
	// Runtime billing still needs a tier for unrecognized upstream values.
	require.Equal(t, VideoBillingResolution480P, NormalizeVideoBillingResolutionOrDefault("4k"))
	require.Equal(t, VideoBillingResolution1080P, NormalizeVideoBillingResolutionOrDefault("full_hd"))
}

func TestMuseVideoBillingDefaults(t *testing.T) {
	t.Parallel()
	require.True(t, IsMuseVideoModel("muse-video"))
	require.True(t, IsMuseVideoModel("muse-cheap"))
	require.False(t, IsMuseVideoModel("muse-spark-1.3-contributor"))
	require.Equal(t, 15, NormalizeVideoBillingDurationSecondsForModelOrDefault("muse-video", 60))
	require.Equal(t, 30, NormalizeVideoBillingDurationSecondsForModelOrDefault("muse-cheap", 45))
	require.Equal(t, VideoBillingResolution720P, NormalizeVideoBillingResolutionForModelOrDefault("muse-video", ""))
	require.Equal(t, VideoBillingResolution720P, NormalizeVideoBillingResolutionForModelOrDefault("muse-cheap", "ignored"))
}

func TestCalculateVideoCostMuseDefaults(t *testing.T) {
	t.Parallel()
	service := &BillingService{}

	museVideo := service.CalculateVideoCost("muse-video", "720p", 1, 1, nil, 1)
	require.InDelta(t, 0.03, museVideo.TotalCost, 1e-9)
	require.InDelta(t, 0.03, museVideo.ActualCost, 1e-9)

	for _, tc := range []struct {
		duration int
		want     float64
	}{
		{duration: 1, want: 0.92},
		{duration: 10, want: 0.92},
		{duration: 20, want: 1.49},
		{duration: 30, want: 1.72},
	} {
		cost := service.CalculateVideoCost("muse-cheap", "720p", 1, tc.duration, nil, 1)
		require.InDelta(t, tc.want, cost.TotalCost, 1e-9, "duration=%d", tc.duration)
	}
}

func TestVideoModelPriceMissingTierFallsBackToFlatTierPrice(t *testing.T) {
	t.Parallel()
	flat720P := 0.7
	service := &BillingService{}

	result := service.CalculateVideoCost("grok-imagine-video", "720p", 1, 1, &VideoPriceConfig{
		Price720P: &flat720P,
		ModelPrices: map[string]map[string]float64{
			VideoPriceFamilyGrokImagineVideo: {VideoBillingResolution480P: 0.05},
		},
	}, 1)

	require.InDelta(t, flat720P, result.TotalCost, 1e-9)
}

func TestVideoDurationRequestTierPriceSelectsDurationTier(t *testing.T) {
	t.Parallel()
	price10 := 2.5
	price15 := 3.5
	resolved := &ResolvedPricing{RequestTiers: []PricingInterval{
		{TierLabel: "480p-10s", PerRequestPrice: &price10},
		{TierLabel: "480p-15s", PerRequestPrice: &price15},
	}}
	require.InDelta(t, 2.5, videoDurationRequestTierPrice(resolved, "480p", 10), 1e-12)
	require.InDelta(t, 3.5, videoDurationRequestTierPrice(resolved, "480p", 15), 1e-12)
	require.Zero(t, videoDurationRequestTierPrice(resolved, "720p", 15))
}

func TestApplyVideoReferenceImageSurchargeUsesPerModelCapabilities(t *testing.T) {
	t.Parallel()
	resolved := &ResolvedPricing{channelPricing: &ChannelModelPricing{
		VideoCapabilities: VideoModelCapabilitiesByModel{
			"minimax H3": {
				ReferenceImageFreeCount:  5,
				ReferenceImageExtraPrice: 0.18,
			},
		},
	}}
	cost := &CostBreakdown{TotalCost: 1, ActualCost: 0.5}
	applyVideoReferenceImageSurcharge(cost, resolved, "minimax H3", 9, 1, 0.5)
	require.InDelta(t, 1.72, cost.TotalCost, 1e-12)
	require.InDelta(t, 0.86, cost.ActualCost, 1e-12)
	require.InDelta(t, 0.36, cost.VideoReferenceImageCost, 1e-12)
}

func TestCalculatePerRequestCostUsesVideoDurationTier(t *testing.T) {
	t.Parallel()
	price10 := 2.5
	price15 := 3.5
	resolved := &ResolvedPricing{
		Mode: BillingModePerRequest,
		RequestTiers: []PricingInterval{
			{TierLabel: "480p-10s", PerRequestPrice: &price10},
			{TierLabel: "480p-15s", PerRequestPrice: &price15},
		},
		DefaultPerRequestPrice: 2.5,
	}
	billing := &BillingService{}
	cost, err := billing.calculatePerRequestCost(resolved, CostInput{
		RequestCount: 1, UsageUnits: 1, SizeTier: "480p", DurationSeconds: 15, RateMultiplier: 1,
	})
	require.NoError(t, err)
	require.InDelta(t, 3.5, cost.TotalCost, 1e-12)
	require.InDelta(t, 3.5, cost.ActualCost, 1e-12)
}

func TestVideoDurationRequestTierPriceRoundsUpForLongReferenceVideo(t *testing.T) {
	t.Parallel()
	price10 := 2.5
	price15 := 3.5
	resolved := &ResolvedPricing{RequestTiers: []PricingInterval{
		{TierLabel: "480p-10s", PerRequestPrice: &price10},
		{TierLabel: "480p-15s", PerRequestPrice: &price15},
	}}
	require.InDelta(t, 3.5, videoDurationRequestTierPrice(resolved, "480p", 12), 1e-12)
}

func TestEffectiveVideoBillingDurationSecondsModes(t *testing.T) {
	t.Parallel()
	resolved := &ResolvedPricing{channelPricing: &ChannelModelPricing{
		VideoCapabilities: VideoModelCapabilitiesByModel{
			"model-max": {ReferenceVideoBillingMode: VideoReferenceBillingModeMaxSeconds},
			"model-sum": {ReferenceVideoBillingMode: VideoReferenceBillingModeSumSeconds},
			"model-off": {ReferenceVideoBillingMode: VideoReferenceBillingModeOff},
		},
	}}
	require.Equal(t, 12, EffectiveVideoBillingDurationSeconds(resolved, "model-max", 10, 12))
	require.Equal(t, 15, EffectiveVideoBillingDurationSeconds(resolved, "model-sum", 10, 5))
	require.Equal(t, 10, EffectiveVideoBillingDurationSeconds(resolved, "model-off", 10, 5))
}
