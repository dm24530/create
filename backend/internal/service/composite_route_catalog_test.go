//go:build unit

package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCompositeRouteResolverFiltersCatalogByEnabledRoutes(t *testing.T) {
	resolver := NewCompositeRouteResolver(compositeRouteRepoStub{routes: []CompositeModelRoute{
		{
			ID: 1, GroupID: 3, PublicModel: "gpt-image-", MatchType: CompositeRouteMatchPrefix,
			TargetPlatform: PlatformOpenAI, Endpoint: CompositeRouteEndpointAny, Enabled: true,
		},
		{
			ID: 2, GroupID: 3, PublicModel: "grok-imagine-video", MatchType: CompositeRouteMatchExact,
			TargetPlatform: PlatformGrok, Endpoint: CompositeRouteEndpointAny, Enabled: true,
		},
	}})
	catalog := []string{
		"gpt-image-2",
		"gpt-image-2.5-flare",
		"grok-imagine-video",
		"gemini-3-pro-image",
		"grok-imagine-image",
	}

	filtered, err := resolver.FilterModelsByRoutes(
		context.Background(),
		3,
		"",
		true,
		map[string]struct{}{PlatformOpenAI: {}, PlatformGrok: {}},
		catalog,
	)
	require.NoError(t, err)
	require.Equal(t, []string{
		"gpt-image-2",
		"gpt-image-2.5-flare",
		"grok-imagine-video",
	}, filtered)
}
