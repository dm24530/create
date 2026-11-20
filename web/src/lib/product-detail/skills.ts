import { nanoid } from "nanoid";

import { mergeProductBrief } from "@/lib/product-detail/brief";
import type { ProductBrief, ProductDetailProject, UserDesignSkill, UserDesignSkillPatch } from "@/types/product-detail";

export function buildSkillCandidate(project: ProductDetailProject): UserDesignSkill {
    const now = Date.now();
    return {
        id: nanoid(),
        userId: project.userId,
        name: `${project.brief.productName || project.name}设计风格`,
        description: `来自“${project.name}”的本地设计偏好。`,
        enabled: true,
        scope: "global",
        category: project.brief.category || undefined,
        platform: project.brief.platform || project.platform,
        brand: {
            colors: [...project.brief.colorPreference],
            fonts: [],
            visualTone: [...project.brief.visualStyle],
        },
        copy: {
            tone: [...project.brief.copyTone],
            preferredPhrases: [],
            forbiddenPhrases: [...project.brief.forbiddenContent],
            density: "balanced",
        },
        layout: {
            preferredTemplates: project.selectedTemplateId ? [project.selectedTemplateId] : [],
        },
        pagePatterns: project.storyboard?.pages.map((page) => ({ role: page.role, guidance: page.message })) || [],
        categoryKnowledge: project.brief.category ? [project.brief.category] : [],
        complianceRules: [...project.brief.forbiddenContent],
        referenceAssetIds: [...project.brief.referenceAssetIds],
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
        sourceProjectIds: Array.from(new Set([...(base.sourceProjectIds || []), ...(patch.sourceProjectIds || [])])),
    };
}
export function applyDesignSkill(brief: ProductBrief, skill: UserDesignSkill): ProductBrief {
    const patch = {
        colorPreference: brief.colorPreference.length ? brief.colorPreference : skill.brand.colors,
        visualStyle: brief.visualStyle.length ? brief.visualStyle : skill.brand.visualTone,
        copyTone: brief.copyTone.length ? brief.copyTone : skill.copy.tone,
        forbiddenContent: brief.forbiddenContent.length ? brief.forbiddenContent : skill.copy.forbiddenPhrases,
    };
    return mergeProductBrief(brief, patch);
}
