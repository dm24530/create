import { describe, expect, it } from "vitest";

import { BUILTIN_HOME_TEXTILE_SKILL_ID, ensureBuiltinSkills } from "@/lib/product-detail/builtin-skills";
import { applyDesignSkill, buildSkillCandidate, findBestSkill, mergeLearnedSkill, mergeSkillCandidate } from "@/lib/product-detail/skills";
import type { ProductDetailProject } from "@/types/product-detail";
import { createEmptyBrief } from "@/lib/product-detail/brief";

const project: ProductDetailProject = {
    id: "project-1",
    userId: 1,
    name: "便携榨汁杯详情页",
    status: "completed",
    platform: "taobao",
    brief: {
        ...createEmptyBrief("taobao"),
        productName: "便携榨汁杯",
        category: "厨房小家电",
        targetAudience: ["上班族"],
        sellingPoints: [{ id: "s1", text: "一键榨汁", source: "user" }],
        visualStyle: ["清爽", "年轻"],
        colorPreference: ["#111111", "#F5F0E8"],
        copyTone: ["直接", "可信"],
        forbiddenContent: ["包治百病"],
    },
    skillIds: [],
    conversationId: "conversation-1",
    pageSpecs: [],
    createdAt: 1,
    updatedAt: 2,
};

describe("product detail user skill", () => {
    it("builds a reusable skill from confirmed project preferences", () => {
        const skill = buildSkillCandidate(project);

        expect(skill.enabled).toBe(true);
        expect(skill.brand.colors).toEqual(["#111111", "#F5F0E8"]);
        expect(skill.copy.tone).toEqual(["直接", "可信"]);
        expect(skill.copy.forbiddenPhrases).toContain("包治百病");
        expect(skill.sourceProjectIds).toEqual(["project-1"]);
    });

    it("applies skill defaults without overwriting explicit project values", () => {
        const brief = mergeSkillBrief();
        const skill = buildSkillCandidate(project);
        const next = applyDesignSkill(brief, skill);

        expect(next.colorPreference).toEqual(["#111111", "#F5F0E8"]);
        expect(next.visualStyle).toEqual(["清爽", "年轻"]);
        expect(next.copyTone).toEqual(["直接", "可信"]);
    });
    it("merges an Agent skill candidate without losing the project baseline", () => {
        const base = buildSkillCandidate(project);
        const next = mergeSkillCandidate(base, {
            name: "高级极简风",
            brand: { colors: ["#1A1A1A"], fonts: ["思源黑体"], visualTone: ["高级", "极简"] },
            copy: { tone: ["克制"], preferredPhrases: [], forbiddenPhrases: ["全网第一"], density: "rich" },
        });

        expect(next.name).toBe("高级极简风");
        expect(next.brand.colors).toEqual(["#1A1A1A"]);
        expect(next.brand.visualTone).toEqual(["高级", "极简"]);
        expect(next.copy.density).toBe("rich");
        expect(next.sourceProjectIds).toEqual(["project-1"]);
    });

    it("recommends a matching category skill and does not leak it to another category", () => {
        const categorySkill = { ...buildSkillCandidate(project), id: "category-skill", scope: "category" as const, category: "厨房小家电", updatedAt: 10 };
        const otherSkill = { ...buildSkillCandidate({ ...project, id: "project-2" }), id: "other-skill", scope: "category" as const, category: "服饰", updatedAt: 20 };

        expect(findBestSkill([otherSkill, categorySkill], project)?.id).toBe("category-skill");
        expect(findBestSkill([otherSkill], project)).toBeUndefined();
    });

    it("updates an existing learned skill instead of creating a duplicate", () => {
        const existing = buildSkillCandidate(project);
        const nextProject = {
            ...project,
            id: "project-2",
            brief: {
                ...project.brief,
                productName: "便携咖啡杯",
                colorPreference: ["#222222", "#FFFFFF"],
                visualStyle: ["简洁", "年轻"],
            },
            storyboard: {
                id: "storyboard-2",
                revision: 1,
                status: "confirmed" as const,
                briefRevision: project.brief.revision,
                pages: [{ ...({ id: "p2", order: 1, role: "hero", title: "主视觉", message: "展示杯身", copy: [], visualPrompt: "", negativePrompt: [], referenceAssetIds: [], factRefs: [], layoutTemplateId: "clean-commerce", status: "ready" } as const) }],
            },
        };
        const learned = mergeLearnedSkill(existing, nextProject);

        expect(learned.id).toBe(existing.id);
        expect(learned.revision).toBe(existing.revision + 1);
        expect(learned.sourceProjectIds).toEqual(["project-1", "project-2"]);
        expect(learned.brand.colors).toEqual(expect.arrayContaining(["#111111", "#F5F0E8", "#222222", "#FFFFFF"]));
        expect(learned.brand.visualTone).toEqual(expect.arrayContaining(["清爽", "年轻", "简洁"]));
        expect(learned.pagePatterns.some((item) => item.guidance === "展示杯身")).toBe(true);
    });

    it("matches the built-in home textile Skill across common bed linen categories", () => {
        const skills = ensureBuiltinSkills([], 1);
        const skill = skills.find((item) => item.id === BUILTIN_HOME_TEXTILE_SKILL_ID);
        const bedLinenProject = {
            ...project,
            brief: { ...project.brief, category: "床品四件套" },
        };

        expect(skills).toHaveLength(7);
        for (const builtin of skills) {
            expect(builtin.brand.colors).toEqual([]);
            expect(builtin.brand.fonts).toEqual([]);
            expect(builtin.brand.visualTone).toEqual([]);
            expect(builtin.layout.preferredTemplates).toEqual([]);
        }
        expect(skill).toBeDefined();
        if (!skill) throw new Error("home textile built-in skill missing");
        expect(findBestSkill(skills, bedLinenProject)?.id).toBe(BUILTIN_HOME_TEXTILE_SKILL_ID);
        expect(findBestSkill(skills, { ...project, brief: { ...project.brief, category: "护肤精华" } })?.id).toBe("builtin-beauty-care-v1");
        expect(findBestSkill(skills, { ...project, brief: { ...project.brief, category: "蓝牙耳机" } })?.id).toBe("builtin-digital-3c-v1");
        expect(skill.pagePatterns.find((pattern) => pattern.role === "feature-detail")?.guidance).toContain("织纹");
        expect(skill.brand.colors).toEqual([]);
        expect(skill.brand.visualTone).toEqual([]);
        expect(skill.brand.fonts).toEqual([]);
        expect(skill.layout.preferredTemplates).toEqual([]);
        expect(skill.complianceRules).toContain("不得预设品牌色、字体、视觉调性或固定版式风格");
    });

    it("prefers a learned category Skill over the generic built-in Skill", () => {
        const [builtIn] = ensureBuiltinSkills([], 1);
        const bedLinenProject = { ...project, brief: { ...project.brief, category: "床品四件套" } };
        const learned = {
            ...buildSkillCandidate(bedLinenProject),
            id: "learned-home-textile",
            category: "家纺",
            scope: "category" as const,
            sourceProjectIds: ["project-1"],
            pagePatterns: [{ role: "hero" as const, guidance: "用户项目已确认的卧室构图" }],
            updatedAt: 10,
        };

        expect(findBestSkill([builtIn, learned], bedLinenProject)?.id).toBe("learned-home-textile");
    });
});
function mergeSkillBrief() {
    return {
        ...createEmptyBrief("taobao"),
        productName: "已有商品",
        category: "已有类目",
        targetAudience: ["已有用户"],
        sellingPoints: [{ id: "existing", text: "已有卖点", source: "user" as const }],
    };
}
