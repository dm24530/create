package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVideoCapabilitiesByModelLookupIsPerModelAndCaseInsensitive(t *testing.T) {
	capabilities := VideoModelCapabilitiesByModel{
		"Model-A": {Protocol: "seedance_video", MinDuration: 5, MaxDuration: 30},
		"Model-B": {Protocol: "muse_video", MinDuration: 1, MaxDuration: 60},
	}
	require.Equal(t, "seedance_video", capabilities.VideoCapabilitiesFor("model-a").Protocol)
	require.Equal(t, "muse_video", capabilities.VideoCapabilitiesFor("MODEL-B").Protocol)
	require.Nil(t, capabilities.VideoCapabilitiesFor("missing"))
}

func TestChannelModelPricingCloneDeeplyCopiesVideoCapabilities(t *testing.T) {
	pricing := ChannelModelPricing{
		VideoCapabilities: VideoModelCapabilitiesByModel{
			"model-a": {
				Protocol:        "seedance_video",
				DurationOptions: []int{5, 15},
				Resolutions:     []string{"720p"},
				AspectRatios:    []string{"16:9"},
				Modes:           []string{"text-to-video"},
				FileLimits:      &VideoReferenceFileLimits{ImageBytes: 10},
			},
		},
	}
	clone := pricing.Clone()
	capability := clone.VideoCapabilities["model-a"]
	capability.DurationOptions[0] = 99
	capability.Resolutions[0] = "1080p"
	capability.AspectRatios[0] = "9:16"
	capability.Modes[0] = "reference-video"
	capability.FileLimits.ImageBytes = 20
	clone.VideoCapabilities["model-a"] = capability

	original := pricing.VideoCapabilities["model-a"]
	require.Equal(t, []int{5, 15}, original.DurationOptions)
	require.Equal(t, []string{"720p"}, original.Resolutions)
	require.Equal(t, []string{"16:9"}, original.AspectRatios)
	require.Equal(t, []string{"text-to-video"}, original.Modes)
	require.Equal(t, int64(10), original.FileLimits.ImageBytes)
}
