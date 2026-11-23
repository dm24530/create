package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// PlazaOfficialPricing 模型广场展示用的官方参考价（USD per token），与计费同源：
// LiteLLM → 内置兜底价卡 → 模型策略。字段为 nil 表示该项缺失（0 视为未配置）。
type PlazaOfficialPricing struct {
	InputPrice        *float64
	OutputPrice       *float64
	CacheWritePrice   *float64 // 5m 缓存写入（= LiteLLM cache_creation）
	CacheWrite1hPrice *float64 // 1h 缓存写入，仅计费会区分 5m/1h 时给出
	CacheReadPrice    *float64
	// Intervals 官方长上下文阶梯（多档时给出），不受分组开关影响。
	Intervals []PricingInterval
}

// PlazaModel 模型广场中单个模型条目：按实收口径合成的展示定价 + 官方参考价。
type PlazaModel struct {
	Name              string
	Platform          string
	Description       string
	VideoCapabilities *VideoModelCapabilities
	Pricing           *ChannelModelPricing
	OfficialPricing   *PlazaOfficialPricing
	// LongContextBasis 多档时的计价基准（整单 / 仅超出部分），单档为空。
	LongContextBasis ContextPricingBasis
	// TimePricing 计费会生效的分时倍率时段；无分时为 nil。
	TimePricing *TimePricingSchedule
}

// PlazaGroup 模型广场中以分组为顶层的条目。
//
// 与 AvailableGroupRef 相比多了 Description 与 Models；Models 来自该分组关联渠道的
// 支持模型（普通分组按分组平台隔离，Composite 分组展开关联渠道已配置的
// 具体平台），与「可用渠道」页口径一致。
type PlazaGroup struct {
	ID                 int64
	Name               string
	Description        string
	I18n               GroupI18n
	Platform           string
	SubscriptionType   string
	RateMultiplier     float64
	PeakRateEnabled    bool
	PeakStart          string
	PeakEnd            string
	PeakRateMultiplier float64
	IsExclusive        bool
	// 图片按次实付倍率：ImageRateIndependent 为 true 时，图片计费模型的实付
	// = 档位价 × ImageRateMultiplier，不乘分组/用户专属倍率（与计费口径一致）。
	ImageRateIndependent bool
	ImageRateMultiplier  float64
	// 视频独立倍率与图片独立倍率分别配置，开启时覆盖分组/用户专属倍率。
	VideoRateIndependent bool
	VideoRateMultiplier  float64
	// LongContextPricingEnabled 分组是否按上下文长度应用阶梯价；关闭时模型展示的是最低档。
	LongContextPricingEnabled bool
	Models                    []PlazaModel
}

type plazaModelKey struct {
	platform string
	name     string
}

// ModelPlazaService 聚合模型广场数据。
//
// 模型枚举来自渠道配置；token 模型的展示单价与阶梯由 BillingService 的阶梯表
// 查询给出（与扣费走同一条解析链与计费函数），图片/按次模型沿用渠道/分组档位价。
type ModelPlazaService struct {
	channelRepo    ChannelRepository
	groupRepo      GroupRepository
	accountRepo    AccountRepository
	pricingService *PricingService
	billingService *BillingService
	resolver       *ModelPricingResolver
}

// NewModelPlazaService 创建模型广场服务。
func NewModelPlazaService(
	channelRepo ChannelRepository,
	groupRepo GroupRepository,
	accountRepo AccountRepository,
	pricingService *PricingService,
	billingService *BillingService,
	resolver *ModelPricingResolver,
) *ModelPlazaService {
	return &ModelPlazaService{
		channelRepo:    channelRepo,
		groupRepo:      groupRepo,
		accountRepo:    accountRepo,
		pricingService: pricingService,
		billingService: billingService,
		resolver:       resolver,
	}
}

// ListGroups 返回模型广场数据：每个活跃分组附带其可用模型与定价。
//
// 模型枚举口径与 ListAvailable 一致（Active 渠道、SupportedModels ∪ 全局定价回落、
// 平台隔离），仅把顶层从渠道换成分组：
//   - 渠道按 lower(name) 排序后遍历，保证同名模型去重结果确定；
//   - 同分组同名模型「先见者胜」，仅当已存条目无定价而新条目有定价时升级替换；
//   - token 模型的单价与阶梯按实收口径合成（见 ResolveContextPricingSchedule），
//     图片计费模型的档位价按实收口径合成（见 plazaImageDisplayPricing）；
//   - 每个模型附带官方参考价（查不到为 nil）；
//   - 只返回 Models 非空的分组；分组按 RateMultiplier 升序（同倍率按名称），
//     组内模型按名称排序。
//
// 可见性过滤（专属分组）不在此层做，由 handler 按登录态裁剪。
func (s *ModelPlazaService) ListGroups(ctx context.Context) ([]PlazaGroup, error) {
	channels, err := s.channelRepo.ListAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}
	groups, err := s.groupRepo.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("list active groups: %w", err)
	}

	accountModelPlatforms := s.loadAccountModelPlatforms(ctx)

	sort.SliceStable(channels, func(i, j int) bool {
		return strings.ToLower(channels[i].Name) < strings.ToLower(channels[j].Name)
	})

	byGroup := make(map[int64]*PlazaGroup, len(groups))
	groupEnt := make(map[int64]*Group, len(groups))
	order := make([]int64, 0, len(groups))
	for i := range groups {
		g := &groups[i]
		byGroup[g.ID] = &PlazaGroup{
			ID:                        g.ID,
			Name:                      g.Name,
			Description:               g.Description,
			I18n:                      g.I18n,
			Platform:                  g.Platform,
			SubscriptionType:          g.SubscriptionType,
			RateMultiplier:            g.RateMultiplier,
			PeakRateEnabled:           g.PeakRateEnabled,
			PeakStart:                 g.PeakStart,
			PeakEnd:                   g.PeakEnd,
			PeakRateMultiplier:        g.PeakRateMultiplier,
			IsExclusive:               g.IsExclusive,
			ImageRateIndependent:      g.ImageRateIndependent,
			ImageRateMultiplier:       g.ImageRateMultiplier,
			VideoRateIndependent:      g.VideoRateIndependent,
			VideoRateMultiplier:       g.VideoRateMultiplier,
			LongContextPricingEnabled: g.LongContextPricingEnabled,
		}
		groupEnt[g.ID] = g
		order = append(order, g.ID)
	}

	// modelIdx[groupID][platform+modelName] = index into byGroup[groupID].Models
	modelIdx := make(map[int64]map[plazaModelKey]int, len(groups))
	for i := range channels {
		ch := &channels[i]
		if ch.Status != StatusActive {
			continue
		}
		ch.normalizeBillingModelSource()
		supported := ch.SupportedModels()
		fillGlobalPricingFallback(s.pricingService, supported)

		for _, gid := range ch.GroupIDs {
			pg, ok := byGroup[gid]
			if !ok {
				continue
			}
			idx := modelIdx[gid]
			if idx == nil {
				idx = make(map[plazaModelKey]int, len(supported))
				modelIdx[gid] = idx
			}
			for j := range supported {
				m := supported[j]
				if pg.Platform == PlatformComposite {
					if !isConcreteRequestPlatform(m.Platform) {
						continue
					}
				} else if m.Platform != pg.Platform {
					continue
				}
				key := plazaModelKey{platform: m.Platform, name: m.Name}
				if at, seen := idx[key]; seen {
					// 先见者胜；仅当已存条目无定价而新条目有定价时升级。
					if pg.Models[at].Pricing == nil && m.Pricing != nil {
						pg.Models[at].Pricing = m.Pricing
					}
					continue
				}
				idx[key] = len(pg.Models)
				pg.Models = append(pg.Models, PlazaModel{
					Name:     m.Name,
					Platform: m.Platform,
					Pricing:  m.Pricing,
				})
			}
		}
	}

	// 后台显式配置的模型同样是广场数据源。渠道定价只覆盖部分模型
	// （例如生图渠道），分组模型定价、视频模型价和模型白名单中已选的
	// 模型也必须进入广场；否则“后台能选/能用，但广场看不到”会再次出现。
	for _, gid := range order {
		pg := byGroup[gid]
		g := groupEnt[gid]
		idx := modelIdx[gid]
		if idx == nil {
			idx = make(map[plazaModelKey]int)
			modelIdx[gid] = idx
		}
		s.addGroupConfiguredModels(pg, g, idx, accountModelPlatforms[gid])
	}

	officialMemo := make(map[string]*PlazaOfficialPricing)
	out := make([]PlazaGroup, 0, len(order))
	for _, gid := range order {
		pg := byGroup[gid]
		if len(pg.Models) == 0 {
			continue
		}
		sort.SliceStable(pg.Models, func(i, j int) bool {
			if pg.Models[i].Name != pg.Models[j].Name {
				return pg.Models[i].Name < pg.Models[j].Name
			}
			return pg.Models[i].Platform < pg.Models[j].Platform
		})
		g := groupEnt[gid]
		for j := range pg.Models {
			s.fillDisplayPricing(ctx, &pg.Models[j], g)
			pg.Models[j].OfficialPricing = s.lookupOfficialPricing(ctx, pg.Models[j].Name, officialMemo)
		}
		out = append(out, *pg)
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].RateMultiplier != out[j].RateMultiplier {
			return out[i].RateMultiplier < out[j].RateMultiplier
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// loadAccountModelPlatforms 返回每个分组中账号模型映射声明的模型平台。
// 账号模型映射是管理员接入模型时的平台事实来源；这里只读取持久化配置候选，
// 不受瞬时限流/冷却影响，避免账号临时不可调度时广场模型消失。
func (s *ModelPlazaService) loadAccountModelPlatforms(ctx context.Context) map[int64]map[string]string {
	out := make(map[int64]map[string]string)
	if s.accountRepo == nil {
		return out
	}
	accounts, err := s.accountRepo.ListActive(ctx)
	if err != nil {
		return out
	}
	for i := range accounts {
		acc := &accounts[i]
		if !acc.Schedulable || !isConcreteRequestPlatform(acc.Platform) {
			continue
		}
		for _, model := range modelNamesFromAccount(acc) {
			for _, gid := range acc.GroupIDs {
				byName := out[gid]
				if byName == nil {
					byName = make(map[string]string)
					out[gid] = byName
				}
				key := strings.ToLower(model)
				if _, exists := byName[key]; !exists {
					byName[key] = acc.Platform
				}
			}
		}
	}
	return out
}

func modelNamesFromAccount(account *Account) []string {
	mapping := account.GetModelMapping()
	names := make([]string, 0, len(mapping))
	for name := range mapping {
		name = strings.TrimSpace(name)
		if name != "" && !strings.Contains(name, "*") {
			names = append(names, name)
		}
	}
	return names
}

// addGroupConfiguredModels 合并后台明确配置的模型，不枚举上游“所有可用模型”。
// 来源仅限管理员写入数据库的分组模型定价、视频模型价和分组模型白名单。
func (s *ModelPlazaService) addGroupConfiguredModels(
	pg *PlazaGroup,
	g *Group,
	idx map[plazaModelKey]int,
	accountPlatforms map[string]string,
) {
	if pg == nil || g == nil {
		return
	}

	resolvePlatform := func(name, configured string) string {
		if isConcreteRequestPlatform(configured) {
			return configured
		}
		if p := accountPlatforms[strings.ToLower(name)]; p != "" {
			return p
		}
		if isConcreteRequestPlatform(g.Platform) {
			return g.Platform
		}
		return inferPlazaModelPlatform(name)
	}
	add := func(name, configuredPlatform string, pricing *ChannelModelPricing) {
		name = strings.TrimSpace(name)
		if name == "" || strings.Contains(name, "*") {
			return
		}
		for i := range pg.Models {
			if !strings.EqualFold(pg.Models[i].Name, name) {
				continue
			}
			if pg.Models[i].Pricing == nil && pricing != nil {
				clone := *pricing
				pg.Models[i].Pricing = &clone
			}
			return
		}
		platform := resolvePlatform(name, configuredPlatform)
		key := plazaModelKey{platform: platform, name: strings.ToLower(name)}
		if at, exists := idx[key]; exists {
			if pg.Models[at].Pricing == nil && pricing != nil {
				clone := *pricing
				pg.Models[at].Pricing = &clone
			}
			return
		}
		var cloned *ChannelModelPricing
		if pricing != nil {
			value := *pricing
			cloned = &value
		}
		idx[key] = len(pg.Models)
		pg.Models = append(pg.Models, PlazaModel{Name: name, Platform: platform, Pricing: cloned})
	}

	for i := range g.ModelPricing {
		pricing := &g.ModelPricing[i]
		for _, model := range pricing.Models {
			add(model, pricing.Platform, pricing)
		}
	}
	for model := range g.VideoModelPrices {
		add(model, "", nil)
	}
	if g.ModelAllowlist.Enabled {
		// 白名单开启时，已选模型就是广场的权威清单；通配符仅基于
		// 账号中真实声明的模型展开，不引入上游未配置的模型。
		for _, model := range g.ModelAllowlist.Models {
			add(model, "", nil)
		}
		for model, platform := range accountPlatforms {
			if g.ModelAllowlist.Allows(model) {
				add(model, platform, nil)
			}
		}
	} else {
		// 白名单关闭时，models 字段只是后台候选勾选状态，不能当成实际
		// 可用模型，否则视频分组会被混入大量文本/图片模型。
		for model, platform := range accountPlatforms {
			add(model, platform, nil)
		}
	}

	if g.ModelAllowlist.Enabled {
		kept := pg.Models[:0]
		for _, model := range pg.Models {
			if g.ModelAllowlist.Allows(model.Name) {
				kept = append(kept, model)
			}
		}
		pg.Models = kept
		for key := range idx {
			delete(idx, key)
		}
		for i := range pg.Models {
			idx[plazaModelKey{platform: pg.Models[i].Platform, name: strings.ToLower(pg.Models[i].Name)}] = i
		}
	}
}

func inferPlazaModelPlatform(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.HasPrefix(name, "claude-"):
		return PlatformAnthropic
	case strings.HasPrefix(name, "gpt-"), strings.HasPrefix(name, "gpt5"), strings.HasPrefix(name, "codex-"),
		strings.HasPrefix(name, "o1"), strings.HasPrefix(name, "o3"), strings.HasPrefix(name, "o4"):
		return PlatformOpenAI
	case strings.HasPrefix(name, "gemini-"):
		return PlatformGemini
	case strings.HasPrefix(name, "grok-"):
		return PlatformGrok
	case strings.HasPrefix(name, "glm-"):
		return PlatformZhipu
	case strings.HasPrefix(name, "kimi-"), strings.HasPrefix(name, "moonshot-"):
		return PlatformKimi
	case strings.HasPrefix(name, "deepseek-"):
		return PlatformDeepseek
	case strings.HasPrefix(name, "minimax-"):
		return PlatformMiniMax
	case strings.HasPrefix(name, "muse-"):
		return PlatformMuse
	default:
		return PlatformComposite
	}
}

// fillDisplayPricing 把模型的展示定价换成实收口径：
// token 模型取计费阶梯表（单价与档位均由真实计费函数得出），
// 图片/按次模型（或阶梯表不可用时）沿用渠道定价与分组图片档位价。
func (s *ModelPlazaService) fillDisplayPricing(ctx context.Context, m *PlazaModel, g *Group) {
	channelDescription := ""
	var channelVideoCapabilities *VideoModelCapabilities
	if m.Pricing != nil {
		channelDescription = strings.TrimSpace(m.Pricing.Description)
		channelVideoCapabilities = m.Pricing.VideoCapabilities.VideoCapabilitiesFor(m.Name)
	}
	defer func() {
		m.VideoCapabilities = channelVideoCapabilities
		description := ""
		if m.Pricing != nil {
			description = strings.TrimSpace(m.Pricing.Description)
		}
		if description == "" {
			description = channelDescription
		}
		m.Description = description
	}()
	explicitGroupPricing := matchGroupModelPricing(g, m.Name)
	if explicitGroupPricing != nil {
		m.Pricing = explicitGroupPricing
		// 分组逐模型定价优先级最高；图片/按次覆盖不应再被分组通用图片价改写。
		if m.Pricing.BillingMode == BillingModeImage || m.Pricing.BillingMode == BillingModePerRequest {
			return
		}
	}
	if m.Pricing != nil && m.Pricing.BillingMode == BillingModeVideo {
		m.Pricing = s.plazaVideoDisplayPricing(m.Name, m.Pricing, g)
		return
	}
	// 图片模型必须先继承分组 1K/2K/4K 价，不能先进入 Token 阶梯查询；
	// 否则账号映射里没有显式图片定价的模型会被误展示为 Token。
	if explicitGroupPricing == nil {
		explicitImagePricing := m.Pricing != nil && m.Pricing.BillingMode == BillingModeImage
		groupImagePricing := hasGroupImagePricing(g) && isPlazaImageModel(m.Name, m.Pricing)
		if explicitImagePricing || groupImagePricing {
			m.Pricing = plazaImageDisplayPricing(m.Name, m.Pricing, g)
			return
		}
	}
	if s.billingService != nil && s.resolver != nil {
		sched, err := s.billingService.ResolveContextPricingSchedule(ctx, s.resolver, ContextPricingScheduleInput{
			Model:    m.Name,
			Group:    g,
			Platform: m.Platform,
		})
		if err == nil && sched != nil && len(sched.Tiers) > 0 {
			m.Pricing = plazaPricingFromSchedule(m.Pricing, sched)
			if len(sched.Tiers) > 1 {
				m.LongContextBasis = sched.Basis
			}
			m.TimePricing = sched.TimePricing
			return
		}
	}
	if explicitGroupPricing == nil {
		m.Pricing = plazaImageDisplayPricing(m.Name, m.Pricing, g)
	}
}

// plazaVideoDisplayPricing 把视频模型的每秒单价合成为分辨率档位。
//
// 优先级与真实计费一致：分组按模型覆盖 > 分组通用视频价 > 渠道分辨率档位 >
// 渠道视频平价 > 已知模型的代码默认价。不同来源缺失解析时跳过该档，
// 避免把未知模型图片兜底价误展示成视频每秒价。
func (s *ModelPlazaService) plazaVideoDisplayPricing(model string, p *ChannelModelPricing, g *Group) *ChannelModelPricing {
	if p == nil {
		return nil
	}
	clone := *p
	clone.BillingMode = BillingModeVideo

	// 显式档位是管理员/同步任务配置的事实来源，必须完整保留。
	// 尤其包含 768p 等非标准分辨率以及按时长分档的按次视频。
	if len(p.Intervals) > 0 {
		clone.Intervals = make([]PricingInterval, 0, len(p.Intervals))
		for _, interval := range p.Intervals {
			if interval.PerRequestPrice != nil {
				clone.Intervals = append(clone.Intervals, interval)
			}
		}
		if len(clone.Intervals) > 0 {
			first := *clone.Intervals[0].PerRequestPrice
			clone.PerRequestPrice = &first
			return &clone
		}
	}

	clone.Intervals = make([]PricingInterval, 0, 3)

	for _, resolution := range []string{
		VideoBillingResolution480P,
		VideoBillingResolution720P,
		VideoBillingResolution1080P,
	} {
		price, ok := plazaVideoPerSecondPrice(model, p, g, resolution, s.billingService)
		if !ok {
			continue
		}
		value := price
		clone.Intervals = append(clone.Intervals, PricingInterval{
			TierLabel:       resolution,
			PerRequestPrice: &value,
			SortOrder:       len(clone.Intervals),
		})
	}
	if len(clone.Intervals) > 0 {
		first := *clone.Intervals[0].PerRequestPrice
		clone.PerRequestPrice = &first
	}
	return &clone
}

func plazaVideoPerSecondPrice(
	model string,
	channelPricing *ChannelModelPricing,
	group *Group,
	resolution string,
	billing *BillingService,
) (float64, bool) {
	if group != nil {
		if price := group.GetVideoPriceForModel(model, resolution); price != nil {
			return *price, true
		}
	}
	if channelPricing != nil {
		for i := range channelPricing.Intervals {
			interval := &channelPricing.Intervals[i]
			tier, ok := LookupVideoBillingResolution(interval.TierLabel)
			if ok && tier == resolution && interval.PerRequestPrice != nil {
				return *interval.PerRequestPrice, true
			}
		}
		if channelPricing.PerRequestPrice != nil {
			return *channelPricing.PerRequestPrice, true
		}
	}
	if billing == nil {
		return 0, false
	}
	return getDefaultGrokImagineVideoPrice(model, resolution)
}

// plazaPricingFromSchedule 把阶梯表压成展示用的 ChannelModelPricing：
// 平价取首档单价，多档时 Intervals 逐档给出绝对单价；图片/按次字段沿用原始定价。
func plazaPricingFromSchedule(raw *ChannelModelPricing, sched *ContextPricingSchedule) *ChannelModelPricing {
	out := &ChannelModelPricing{BillingMode: BillingModeToken}
	if raw != nil {
		out.Description = raw.Description
		out.ImageInputPrice = raw.ImageInputPrice
		out.ImageOutputPrice = raw.ImageOutputPrice
		out.PerRequestPrice = raw.PerRequestPrice
		out.ReasoningEffortMultipliers = reasoningEffortMultipliersFromPricing(raw)
	}
	first := sched.Tiers[0]
	out.InputPrice = first.Input
	out.OutputPrice = first.Output
	out.CacheWritePrice = first.CacheWrite
	out.CacheWrite1hPrice = first.CacheWrite1h
	out.CacheReadPrice = first.CacheRead
	if len(sched.Tiers) > 1 {
		out.Intervals = plazaIntervalsFromTiers(sched.Tiers)
	}
	return out
}

func plazaIntervalsFromTiers(tiers []ContextPricingTier) []PricingInterval {
	intervals := make([]PricingInterval, 0, len(tiers))
	for i, t := range tiers {
		intervals = append(intervals, PricingInterval{
			MinTokens:         t.MinTokens,
			MaxTokens:         t.MaxTokens,
			TierLabel:         t.Label,
			InputPrice:        t.Input,
			OutputPrice:       t.Output,
			CacheWritePrice:   t.CacheWrite,
			CacheWrite1hPrice: t.CacheWrite1h,
			CacheReadPrice:    t.CacheRead,
			SortOrder:         i,
		})
	}
	return intervals
}

// plazaImageDisplayPricing 为图片计费模型合成展示定价，使档位价与实收口径一致：
// 每档（1K/2K/4K）单价 = 分组图片价 > 渠道同档位价 > 渠道默认按次价，无价的档不展示。
// 分组未配任何图片价、或定价非图片模式时原样返回。返回克隆，不修改入参
// （渠道定价指针指向缓存共享数据）。
func hasGroupImagePricing(g *Group) bool {
	return g != nil && (g.ImagePrice1K != nil || g.ImagePrice2K != nil || g.ImagePrice4K != nil)
}

func plazaImageDisplayPricing(model string, p *ChannelModelPricing, g *Group) *ChannelModelPricing {
	if g == nil || !isPlazaImageModel(model, p) {
		return p
	}
	if g.ImagePrice1K == nil && g.ImagePrice2K == nil && g.ImagePrice4K == nil {
		return p
	}
	channelTierPrice := func(label string) *float64 {
		if p == nil {
			return nil
		}
		for i := range p.Intervals {
			if p.Intervals[i].TierLabel == label && p.Intervals[i].PerRequestPrice != nil {
				return p.Intervals[i].PerRequestPrice
			}
		}
		return p.PerRequestPrice
	}
	tiers := []struct {
		label      string
		groupPrice *float64
	}{
		{"1K", g.ImagePrice1K},
		{"2K", g.ImagePrice2K},
		{"4K", g.ImagePrice4K},
	}
	clone := ChannelModelPricing{BillingMode: BillingModeImage}
	if p != nil {
		clone = *p
		clone.BillingMode = BillingModeImage
	}
	clone.Intervals = make([]PricingInterval, 0, len(tiers))
	for i, t := range tiers {
		price := t.groupPrice
		if price == nil {
			price = channelTierPrice(t.label)
		}
		if price == nil {
			continue
		}
		v := *price
		clone.Intervals = append(clone.Intervals, PricingInterval{
			TierLabel:       t.label,
			PerRequestPrice: &v,
			SortOrder:       i,
		})
	}
	if len(clone.Intervals) == 0 {
		return p
	}
	first := *clone.Intervals[0].PerRequestPrice
	clone.PerRequestPrice = &first
	return &clone
}

// isPlazaImageModel 判断模型是否应按图片计费展示。渠道/账号模型可能没有显式
// BillingModeImage，但名称已经明确是图片模型，因此仍应继承分组 1K/2K/4K 价格。
func isPlazaImageModel(model string, p *ChannelModelPricing) bool {
	if p != nil && p.BillingMode == BillingModeImage {
		return true
	}
	name := strings.ToLower(strings.TrimSpace(model))
	name = strings.TrimPrefix(name, "models/")
	return isImageGenerationModel(name) ||
		isGeminiCompatibleImageModel(name) ||
		IsGPTImageGenerationModel(name) ||
		isGrokImageGenerationModel(name) ||
		strings.HasPrefix(name, "dall-e-") ||
		strings.HasPrefix(name, "imagen-") ||
		strings.HasPrefix(name, "flux-") ||
		strings.HasPrefix(name, "seedream-") ||
		strings.HasPrefix(name, "ideogram-") ||
		strings.HasPrefix(name, "recraft-") ||
		strings.Contains(name, "qwen-image") ||
		strings.Contains(name, "hunyuan-image") ||
		strings.Contains(name, "wanx")
}

// lookupOfficialPricing 查询模型的官方参考价（与计费同源：LiteLLM → 内置兜底 → 模型策略），
// 带 memo 避免同名模型重复解析。官方阶梯按无分组、无渠道的口径查阶梯表。
// billingService 为 nil（测试场景）或查不到时返回 nil。
func (s *ModelPlazaService) lookupOfficialPricing(ctx context.Context, modelName string, memo map[string]*PlazaOfficialPricing) *PlazaOfficialPricing {
	if s.billingService == nil {
		return nil
	}
	if cached, ok := memo[modelName]; ok {
		return cached
	}
	var result *PlazaOfficialPricing
	if mp, err := s.billingService.GetModelPricing(modelName); err == nil && mp != nil {
		result = &PlazaOfficialPricing{
			InputPrice:      nonZeroPtr(mp.InputPricePerToken),
			OutputPrice:     nonZeroPtr(mp.OutputPricePerToken),
			CacheWritePrice: nonZeroPtr(mp.CacheCreationPricePerToken),
			CacheReadPrice:  nonZeroPtr(mp.CacheReadPricePerToken),
		}
		// 计费只在支持 5m/1h 分档时使用 1h 价，其余情况 1h 价对用户无意义。
		if mp.SupportsCacheBreakdown {
			result.CacheWrite1hPrice = nonZeroPtr(mp.CacheCreation1hPrice)
		}
		if s.resolver != nil {
			sched, schedErr := s.billingService.ResolveContextPricingSchedule(ctx, s.resolver, ContextPricingScheduleInput{Model: modelName})
			if schedErr == nil && sched != nil && len(sched.Tiers) > 1 {
				result.Intervals = plazaIntervalsFromTiers(sched.Tiers)
			}
		}
		if result.InputPrice == nil && result.OutputPrice == nil && result.CacheWritePrice == nil &&
			result.CacheWrite1hPrice == nil && result.CacheReadPrice == nil && len(result.Intervals) == 0 {
			result = nil
		}
	}
	memo[modelName] = result
	return result
}
