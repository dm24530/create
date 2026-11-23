package service

import "context"

// VideoCapabilitiesForModel resolves capability metadata from the group pricing
// entry first, then from the channel that serves the group. This keeps billing
// metadata independent from concrete model names.
func (s *OpenAIGatewayService) VideoCapabilitiesForModel(ctx context.Context, group *Group, model string) *VideoModelCapabilities {
	if s == nil || group == nil {
		return nil
	}
	if pricing := group.ModelPricingFor(model); pricing != nil {
		if capabilities := pricing.VideoCapabilities.VideoCapabilitiesFor(model); capabilities != nil {
			return capabilities
		}
	}
	if s.resolver != nil {
		if pricing := s.resolver.lookupChannelPricingNormalized(ctx, group.ID, model); pricing != nil {
			return pricing.VideoCapabilities.VideoCapabilitiesFor(model)
		}
	}
	return nil
}
