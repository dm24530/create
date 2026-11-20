import { describe, expect, it } from "vitest";

import { applyDesignSkill, buildSkillCandidate, mergeSkillCandidate } from "@/lib/product-detail/skills";
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
