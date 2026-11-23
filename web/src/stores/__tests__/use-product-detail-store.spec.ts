import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { ensureBuiltinSkills } from "@/lib/product-detail/builtin-skills";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { createFallbackStoryboard, isStoryboardStale } from "@/lib/product-detail/storyboard";
import type { ProductDetailProject, ProductDetailWorkspace } from "@/types/product-detail";

vi.mock("@/services/product-detail/storage", () => ({
    loadProductDetailWorkspace: vi.fn(async () => ({ version: 1, projects: [], skills: [], updatedAt: Date.now() })),
    saveProductDetailWorkspace: vi.fn(async () => undefined),
    clearProductDetailWorkspace: vi.fn(async () => undefined),
}));

import { useProductDetailStore } from "@/stores/use-product-detail-store";

const projectId = "project-1";

function createProject(): ProductDetailProject {
    const brief = {
        ...createEmptyBrief("taobao"),
        productName: "便携榨汁杯",
        category: "厨房小家电",
        targetAudience: ["上班族"],
        sellingPoints: [{ id: "fact-1", text: "一键榨汁", source: "user" as const }],
        productAssetIds: ["asset-1"],
        revision: 4,
    };
    return {
        id: projectId,
        userId: 1,
        name: "便携榨汁杯",
        status: "storyboard_confirmed",
        platform: "taobao",
        brief,
        skillIds: [],
        conversationId: "conversation-1",
        textModel: "deepseek-chat",
        imageModel: "image-model",
        messages: [],
        storyboard: {
            ...createFallbackStoryboard(brief, createEmptySkill(1)),
            status: "confirmed",
        },
        pageSpecs: [],
        assets: [{
            id: "asset-1",
            name: "product.png",
            kind: "product",
            storageKey: "asset-1",
            mimeType: "image/png",
            createdAt: Date.now(),
        }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function setWorkspace(project: ProductDetailProject) {
    const workspace: ProductDetailWorkspace = {
        version: 1,
        projects: [project],
        skills: [],
        activeProjectId: project.id,
        updatedAt: Date.now(),
    };
    useProductDetailStore.setState({ workspace, saving: false, error: "" });
}

describe("product detail store invalidation", () => {
    beforeEach(() => {
        setWorkspace(createProject());
    });

    it("invalidates the confirmed storyboard when brief content changes", () => {
        useProductDetailStore.getState().updateBrief(projectId, { description: "新的商品描述" });
        const project = useProductDetailStore.getState().workspace.projects[0];

        expect(project.brief.revision).toBe(5);
        expect(project.storyboard?.status).toBe("draft");
        expect(project.storyboard?.warning).toContain("需要重新生成分镜");
        expect(isStoryboardStale(project.storyboard, project.brief)).toBe(true);
    });

    it("does not invalidate anything when the brief content is unchanged", () => {
        const before = useProductDetailStore.getState().workspace.projects[0];
        useProductDetailStore.getState().updateBrief(projectId, { productName: before.brief.productName });
        const after = useProductDetailStore.getState().workspace.projects[0];

        expect(after.brief.revision).toBe(before.brief.revision);
        expect(after.storyboard).toBe(before.storyboard);
    });

    it("invalidates the storyboard when a referenced product image is removed", () => {
        useProductDetailStore.getState().removeAsset(projectId, "asset-1");
        const project = useProductDetailStore.getState().workspace.projects[0];

        expect(project.assets).toHaveLength(0);
        expect(project.brief.productAssetIds).toEqual([]);
        expect(project.brief.revision).toBe(5);
        expect(project.storyboard?.status).toBe("draft");
        expect(isStoryboardStale(project.storyboard, project.brief)).toBe(true);
    });

    it("refuses to confirm a fallback storyboard that carries a warning", () => {
        const project = createProject();
        project.status = "storyboard_draft";
        project.storyboard = {
            ...project.storyboard!,
            status: "draft",
            warning: "文本模型调用失败",
        };
        setWorkspace(project);

        useProductDetailStore.getState().confirmStoryboard(projectId);
        const next = useProductDetailStore.getState().workspace.projects[0];

        expect(next.storyboard?.status).toBe("draft");
        expect(next.status).not.toBe("storyboard_confirmed");
    });

    it("applies design defaults when a matching Skill is attached", () => {
        const project = createProject();
        const skill = {
            ...createEmptySkill(1),
            id: "skill-1",
            name: "厨房小家电风格",
            scope: "category" as const,
            category: "厨房小家电",
            platform: "taobao" as const,
            brand: { colors: ["#111111"], fonts: ["Microsoft YaHei"], visualTone: ["清爽"] },
            copy: { tone: ["直接"], preferredPhrases: [], forbiddenPhrases: ["包治百病"], density: "balanced" as const },
        };
        setWorkspace(project);
        useProductDetailStore.setState((state) => ({ workspace: { ...state.workspace, skills: [skill] } }));

        useProductDetailStore.getState().attachSkill(projectId, skill.id);
        const next = useProductDetailStore.getState().workspace.projects[0];

        expect(next.skillIds).toContain(skill.id);
        expect(next.brief.colorPreference).toEqual(["#111111"]);
        expect(next.brief.visualStyle).toEqual(["清爽"]);
        expect(next.brief.copyTone).toEqual(["直接"]);
        expect(next.storyboard?.status).toBe("draft");
    });

    it("learns into the same Skill on repeated saves", () => {
        const project = createProject();
        setWorkspace(project);

        const first = useProductDetailStore.getState().saveProjectSkill(projectId);
        const second = useProductDetailStore.getState().saveProjectSkill(projectId);
        const skills = useProductDetailStore.getState().workspace.skills;

        expect(first?.created).toBe(true);
        expect(second?.created).toBe(false);
        expect(skills).toHaveLength(1);
        expect(skills[0].id).toBe(first?.id);
        expect(skills[0].revision).toBe(2);
    });

    it("does not bump Skill revision when it is enabled or disabled", () => {
        const project = createProject();
        const skill = {
            ...createEmptySkill(1),
            id: "skill-toggle",
            name: "可启停 Skill",
            enabled: true,
            revision: 7,
            updatedAt: 123,
        };
        setWorkspace(project);
        useProductDetailStore.setState((state) => ({ workspace: { ...state.workspace, skills: [skill] } }));

        useProductDetailStore.getState().toggleSkill(skill.id, false);
        let current = useProductDetailStore.getState().workspace.skills.find((item) => item.id === skill.id);
        expect(current?.enabled).toBe(false);
        expect(current?.revision).toBe(7);
        expect(current?.updatedAt).toBe(123);

        useProductDetailStore.getState().toggleSkill(skill.id, true);
        current = useProductDetailStore.getState().workspace.skills.find((item) => item.id === skill.id);
        expect(current?.enabled).toBe(true);
        expect(current?.revision).toBe(7);
        expect(current?.updatedAt).toBe(123);
    });
    it("seeds the built-in home textile Skill when the workspace loads", async () => {
        await useProductDetailStore.getState().load();
        const skills = useProductDetailStore.getState().workspace.skills;

        expect(skills.some((skill) => skill.id === "builtin-home-textile-v1" && skill.category === "家纺")).toBe(true);
    });

    it("creates a user-defined structural Skill without inventing style", () => {
        const id = useProductDetailStore.getState().createSkill({
            name: "我的床品结构 Skill",
            description: "只沉淀页面结构",
            scope: "category",
            category: "床品四件套",
        });
        const skill = useProductDetailStore.getState().workspace.skills.find((item) => item.id === id);

        expect(skill?.name).toBe("我的床品结构 Skill");
        expect(skill?.category).toBe("床品四件套");
        expect(skill?.brand.colors).toEqual([]);
        expect(skill?.brand.visualTone).toEqual([]);
        expect(skill?.layout.preferredTemplates).toEqual([]);
    });

    it("automatically attaches the best matching Skill when the category is set", () => {
        const project = createProject();
        setWorkspace(project);
        const skills = ensureBuiltinSkills([], 1);
        useProductDetailStore.setState((state) => ({ workspace: { ...state.workspace, skills } }));

        useProductDetailStore.getState().updateBrief(projectId, { category: "床品四件套" });
        const next = useProductDetailStore.getState().workspace.projects[0];

        expect(next.skillIds).toContain("builtin-home-textile-v1");
    });
});
