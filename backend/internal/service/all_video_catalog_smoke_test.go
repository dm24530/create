package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type smokeCatalogEntry struct {
	ModelName    string                 `json:"model_name"`
	Capabilities VideoModelCapabilities `json:"capabilities"`
}

func TestAllVideoModelCapabilitiesSyntheticSmoke(t *testing.T) {
	path := filepath.Join("..", "..", "migrations", "276_channel_video_capabilities.sql")
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	sql := string(raw)
	start := strings.Index(sql, "$catalog$")
	require.GreaterOrEqual(t, start, 0)
	start += len("$catalog$")
	end := strings.Index(sql[start:], "$catalog$::jsonb")
	require.GreaterOrEqual(t, end, 0)
	var entries []smokeCatalogEntry
	require.NoError(t, json.Unmarshal([]byte(sql[start:start+end]), &entries))
	require.Len(t, entries, 23)

	validProtocols := map[string]bool{
		"seedance": true, "seedance_video": true, "muse_video": true, "video_tasks": true, "grok": true,
	}
	for _, entry := range entries {
		t.Run(entry.ModelName, func(t *testing.T) {
			capabilities := entry.Capabilities
			require.True(t, validProtocols[capabilities.Protocol], "invalid protocol")
			require.Greater(t, capabilities.MinDuration, 0)
			require.GreaterOrEqual(t, capabilities.MaxDuration, capabilities.MinDuration)
			require.GreaterOrEqual(t, capabilities.DefaultDuration, capabilities.MinDuration)
			require.LessOrEqual(t, capabilities.DefaultDuration, capabilities.MaxDuration)
			require.NotEmpty(t, capabilities.Resolutions)
			require.NotEmpty(t, capabilities.AspectRatios)
			if len(capabilities.DurationOptions) > 0 {
				require.Contains(t, capabilities.DurationOptions, capabilities.DefaultDuration)
			}
			require.GreaterOrEqual(t, capabilities.Slots.FirstFrame, 0)
			require.GreaterOrEqual(t, capabilities.Slots.LastFrame, 0)
			require.GreaterOrEqual(t, capabilities.Slots.ReferenceImage, 0)
			require.GreaterOrEqual(t, capabilities.Slots.ReferenceVideo, 0)
			require.GreaterOrEqual(t, capabilities.Slots.ReferenceAudio, 0)

			resolved := &ResolvedPricing{channelPricing: &ChannelModelPricing{
				VideoCapabilities: VideoModelCapabilitiesByModel{entry.ModelName: capabilities},
			}}
			switch capabilities.ReferenceVideoBillingMode {
			case "", VideoReferenceBillingModeOff:
				require.Equal(t, 10, EffectiveVideoBillingDurationSeconds(resolved, entry.ModelName, 10, 12))
			case VideoReferenceBillingModeMaxSeconds:
				require.Greater(t, capabilities.Slots.ReferenceVideo, 0)
				require.Equal(t, 12, EffectiveVideoBillingDurationSeconds(resolved, entry.ModelName, 10, 12))
			case VideoReferenceBillingModeSumSeconds:
				require.Greater(t, capabilities.Slots.ReferenceVideo, 0)
				require.Equal(t, 22, EffectiveVideoBillingDurationSeconds(resolved, entry.ModelName, 10, 12))
			default:
				t.Fatalf("invalid reference video billing mode %q", capabilities.ReferenceVideoBillingMode)
			}
			if capabilities.ReferenceImageExtraPrice > 0 {
				require.Greater(t, capabilities.ReferenceImageFreeCount, 0)
			}
		})
	}
}
