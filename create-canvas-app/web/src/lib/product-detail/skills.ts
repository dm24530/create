import { nanoid } from "nanoid";

import { mergeProductBrief } from "@/lib/product-detail/brief";
import type { ProductBrief, ProductDetailProject, UserDesignSkill, UserDesignSkillPatch } from "@/types/product-detail";

const MAX_COLORS = 8;
const MAX_FONTS = 4;
const MAX_TONES = 8;
const MAX_PHRASES = 12;
const MAX_TEMPLATES = 6;
const MAX_PATTERNS_PER_ROLE = 4;
const MAX_KNOWLEDGE = 12;
const MAX_REFERENCES = 16;
const CATEGORY_ALIAS_GROUPS: Array<{ key: string; aliases: string[] }> = [
    { key: "家纺床品", aliases: ["家纺", "床品", "床上用品", "四件套", "被套", "被芯", "被子", "枕芯", "枕头", "床垫", "床单", "床笠", "毛毯", "珊瑚绒", "法兰绒", "牛奶绒", "窗帘", "毛巾", "浴巾"] },
    { key: "美妆个护", aliases: ["美妆", "护肤", "彩妆", "个护", "洗护", "香水", "口红", "面霜", "精华"] },
    { key: "食品饮料", aliases: ["食品", "饮料", "零食", "茶", "咖啡", "酒", "乳品", "糕点", "调味"] },
    { key: "数码3C", aliases: ["数码", "3c", "手机", "电脑", "耳机", "相机", "智能设备", "平板", "键盘", "鼠标"] },
    { key: "服饰鞋包", aliases: ["服饰", "服装", "女装", "男装", "童装", "鞋", "箱包", "背包", "内衣", "配饰"] },
    { key: "家居日用", aliases: ["家居", "日用", "厨具", "收纳", "清洁", "餐具", "水杯", "家具"] },
    { key: "母婴用品", aliases: ["母婴", "婴儿", "幼儿", "儿童", "奶瓶", "纸尿裤", "推车", "辅食"] },
];

export function buildSkillCandidate(project: ProductDetailProject): UserDesignSkill {
    const now = Date.now();
    return {
        id: nanoid(),
        userId: project.userId,
        name: `${project.brief.productName || project.name}设计风格`,
        description: `来自“${project.name}”的本地设计偏好。`,
        enabled: true,
        scope: project.brief.category ? "category" : "platform",
        category: project.brief.category || undefined,
        platform: project.brief.platform || project.platform,
        brand: {
            colors: unique(project.brief.colorPreference).slice(0, MAX_COLORS),
            fonts: [],
            visualTone: unique(project.brief.visualStyle).slice(0, MAX_TONES),
        },
        copy: {
            tone: unique(project.brief.copyTone).slice(0, MAX_TONES),
            preferredPhrases: [],
            forbiddenPhrases: unique(project.brief.forbiddenContent).slice(0, MAX_PHRASES),
            density: "balanced",
        },
        layout: {
            preferredTemplates: project.selectedTemplateId ? [project.selectedTemplateId] : [],
        },
        pagePatterns: mergePagePatterns([], project.storyboard?.pages.map((page) => ({ role: page.role, guidance: page.message })) || []),
        categoryKnowledge: project.brief.category ? [project.brief.category] : [],
        complianceRules: unique(project.brief.forbiddenContent).slice(0, MAX_PHRASES),
        referenceAssetIds: unique(project.brief.referenceAssetIds).slice(0, MAX_REFERENCES),
        sourceProjectIds: [project.id],
        revision: 1,
        createdAt: now,
        updatedAt: now,
    };
}

export function mergeSkillCandidate(base: UserDesignSkill, patch?: UserDesignSkillPatch): UserDesignSkill {
    if (!patch) return base;
    return {
        ...base,
        ...patch,
        id: base.id,
        userId: base.userId,
        revision: base.revision,
        createdAt: base.createdAt,
        updatedAt: Date.now(),
        brand: { ...base.brand, ...(patch.brand || {}) },
        copy: { ...base.copy, ...(patch.copy || {}) },
        layout: { ...base.layout, ...(patch.layout || {}) },
        sourceProjectIds: unique([...(base.sourceProjectIds || []), ...(patch.sourceProjectIds || [])]),
    };
}

export function applyDesignSkill(brief: ProductBrief, skill: UserDesignSkill): ProductBrief {
    const patch = {
        ...(!brief.colorPreference.length && skill.brand.colors.length ? { colorPreference: skill.brand.colors } : {}),
        ...(!brief.visualStyle.length && skill.brand.visualTone.length ? { visualStyle: skill.brand.visualTone } : {}),
        ...(!brief.copyTone.length && skill.copy.tone.length ? { copyTone: skill.copy.tone } : {}),
        ...(!brief.forbiddenContent.length && skill.copy.forbiddenPhrases.length ? { forbiddenContent: skill.copy.forbiddenPhrases } : {}),
    };
    if (!Object.keys(patch).length) return brief;
    return mergeProductBrief(brief, patch);
}

export function skillMatchScore(skill: UserDesignSkill, project: Pick<ProductDetailProject, "platform" | "brief" | "skillIds">): number {
    if (!skill.enabled) return Number.NEGATIVE_INFINITY;
    if (project.skillIds.includes(skill.id)) return 1000 + skill.revision;
    const platformMatches = skill.platform === project.platform;
    const categoryMatches = Boolean(skill.category && project.brief.category && categoryKey(skill.category) === categoryKey(project.brief.category));
    if (skill.scope === "platform" && !platformMatches) return Number.NEGATIVE_INFINITY;
    if (skill.scope === "category" && !categoryMatches) return Number.NEGATIVE_INFINITY;
    let score = platformMatches ? 40 : 0;
    if (categoryMatches) score += 80;
    if (skill.scope === "global") score += 10;
    score += skill.id.startsWith("builtin-") ? -30 : Math.min(20, skill.sourceProjectIds.length * 4);
    score += Math.min(10, skill.pagePatterns.length);
    score += Math.min(5, skill.copy.preferredPhrases.length);
    return score;
}

export function findBestSkill(skills: UserDesignSkill[], project: Pick<ProductDetailProject, "platform" | "brief" | "skillIds">): UserDesignSkill | undefined {
    return [...skills]
        .map((skill) => ({ skill, score: skillMatchScore(skill, project) }))
        .filter((item) => Number.isFinite(item.score))
        .sort((a, b) => b.score - a.score || b.skill.updatedAt - a.skill.updatedAt)[0]?.skill;
}

export function mergeLearnedSkill(existing: UserDesignSkill, project: ProductDetailProject, patch?: UserDesignSkillPatch): UserDesignSkill {
    const candidate = buildSkillCandidate(project);
    const mergedPatch = mergeSkillCandidate(candidate, patch);
    const sourceProjectIds = unique([...existing.sourceProjectIds, project.id]);
    const next = mergeSkillCandidate(existing, {
        ...patch,
        scope: patch?.scope || existing.scope || candidate.scope,
        category: patch?.category ?? existing.category ?? candidate.category,
        platform: patch?.platform || existing.platform || candidate.platform,
        sourceProjectIds,
        brand: {
            colors: unique([...existing.brand.colors, ...candidate.brand.colors, ...(patch?.brand?.colors || [])]).slice(0, MAX_COLORS),
            fonts: unique([...existing.brand.fonts, ...candidate.brand.fonts, ...(patch?.brand?.fonts || [])]).slice(0, MAX_FONTS),
            visualTone: unique([...existing.brand.visualTone, ...candidate.brand.visualTone, ...(patch?.brand?.visualTone || [])]).slice(0, MAX_TONES),
            logoAssetId: patch?.brand?.logoAssetId || existing.brand.logoAssetId || candidate.brand.logoAssetId,
        },
        copy: {
            tone: unique([...existing.copy.tone, ...candidate.copy.tone, ...(patch?.copy?.tone || [])]).slice(0, MAX_TONES),
            preferredPhrases: unique([...existing.copy.preferredPhrases, ...candidate.copy.preferredPhrases, ...(patch?.copy?.preferredPhrases || [])]).slice(0, MAX_PHRASES),
            forbiddenPhrases: unique([...existing.copy.forbiddenPhrases, ...candidate.copy.forbiddenPhrases, ...(patch?.copy?.forbiddenPhrases || [])]).slice(0, MAX_PHRASES),
            density: patch?.copy?.density || existing.copy.density || candidate.copy.density,
        },
        layout: {
            ...existing.layout,
            ...(patch?.layout || {}),
            preferredTemplates: unique([...existing.layout.preferredTemplates, ...candidate.layout.preferredTemplates, ...(patch?.layout?.preferredTemplates || [])]).slice(0, MAX_TEMPLATES),
        },
        pagePatterns: mergePagePatterns(existing.pagePatterns, [...candidate.pagePatterns, ...(patch?.pagePatterns || [])]),
        categoryKnowledge: unique([...existing.categoryKnowledge, ...candidate.categoryKnowledge, ...(patch?.categoryKnowledge || [])]).slice(0, MAX_KNOWLEDGE),
        complianceRules: unique([...existing.complianceRules, ...candidate.complianceRules, ...(patch?.complianceRules || [])]).slice(0, MAX_PHRASES),
        referenceAssetIds: unique([...existing.referenceAssetIds, ...candidate.referenceAssetIds, ...(patch?.referenceAssetIds || [])]).slice(0, MAX_REFERENCES),
    });
    return {
        ...next,
        name: patch?.name || existing.name || mergedPatch.name,
        description: patch?.description || defaultLearningDescription(existing.description, sourceProjectIds.length),
        sourceProjectIds,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
    };
}

function mergePagePatterns(current: UserDesignSkill["pagePatterns"], incoming: UserDesignSkill["pagePatterns"]) {
    const result: UserDesignSkill["pagePatterns"] = [];
    const seen = new Set<string>();
    for (const pattern of [...current, ...incoming]) {
        const guidance = pattern.guidance.trim();
        if (!guidance) continue;
        const key = `${pattern.role}:${normalize(guidance)}`;
        if (seen.has(key)) continue;
        const count = result.filter((item) => item.role === pattern.role).length;
        if (count >= MAX_PATTERNS_PER_ROLE) continue;
        seen.add(key);
        result.push({ role: pattern.role, guidance });
    }
    return result;
}

function defaultLearningDescription(current: string, sourceCount: number) {
    if (current && !current.startsWith("来自") && !current.startsWith("已从") && !current.startsWith("从已完成")) return current;
    return `已从 ${sourceCount} 个相似项目沉淀的本地设计偏好。`;
}

function unique(values: string[]) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function categoryKey(value: string) {
    const normalized = normalize(value);
    return CATEGORY_ALIAS_GROUPS.find((group) => group.aliases.some((alias) => normalized.includes(normalize(alias))))?.key || normalized;
}

function normalize(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, "");
}