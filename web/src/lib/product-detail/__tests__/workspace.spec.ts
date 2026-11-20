import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptyWorkspace, removeProject, removeSkill, upsertProject, upsertSkill } from "@/lib/product-detail/workspace";
import type { ProductDetailProject, UserDesignSkill } from "@/types/product-detail";

const project: ProductDetailProject = {
    id: "project-1",
    userId: 7,
    name: "测试详情页",
    status: "discovery",
    platform: "taobao",
    brief: createEmptyBrief("taobao"),
    skillIds: [],
    conversationId: "conversation-1",
    messages: [],
    pageSpecs: [],
    assets: [],
    createdAt: 1,
    updatedAt: 1,
};

const skill: UserDesignSkill = {
    id: "skill-1",
    userId: 7,
    name: "测试 Skill",
    description: "测试",
    enabled: true,
    scope: "global",
    brand: { colors: [], fonts: [], visualTone: [] },
    copy: { tone: [], preferredPhrases: [], forbiddenPhrases: [], density: "balanced" },
    layout: { preferredTemplates: [] },
    pagePatterns: [],
    categoryKnowledge: [],
    complianceRules: [],
    referenceAssetIds: [],
    sourceProjectIds: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
};

describe("product detail workspace", () => {
    it("stores projects and skills without replacing unrelated records", () => {
        const workspace = upsertSkill(upsertProject(createEmptyWorkspace(), project), skill);

        expect(workspace.projects).toHaveLength(1);
        expect(workspace.skills).toHaveLength(1);
        expect(workspace.activeProjectId).toBe("project-1");
    });

    it("removes only the selected project or skill", () => {
        const populated = upsertSkill(upsertProject(createEmptyWorkspace(), project), skill);

        expect(removeProject(populated, "project-1").projects).toHaveLength(0);
        expect(removeProject(populated, "project-1").skills).toHaveLength(1);
        expect(removeSkill(populated, "skill-1").skills).toHaveLength(0);
    });
});
