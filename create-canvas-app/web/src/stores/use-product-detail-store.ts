import { create } from "zustand";
import { nanoid } from "nanoid";

import { ensureBuiltinSkills } from "@/lib/product-detail/builtin-skills";
import { createEmptyBrief, createEmptySkill, createEmptyWorkspace } from "@/lib/product-detail/defaults";
import { mergeProductBrief } from "@/lib/product-detail/brief";
import { createProductDetailWelcomeMessage } from "@/lib/product-detail/conversation";
import { applyDesignSkill, buildSkillCandidate, findBestSkill, mergeLearnedSkill, mergeSkillCandidate } from "@/lib/product-detail/skills";
import { ensureStoryboardVisualPrompts, isStoryboardStale } from "@/lib/product-detail/storyboard";
import { removeProject, removeSkill, selectProject, upsertProject, upsertSkill } from "@/lib/product-detail/workspace";
import { loadProductDetailWorkspace, saveProductDetailWorkspace } from "@/services/product-detail/storage";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore } from "@/stores/use-config-store";
import type {
    ProductBriefPatch,
    ProductDetailAsset,
    ProductDetailConversationMessage,
    ProductDetailPlatform,
    ProductDetailProject,
    ProductDetailProjectStatus,
    ProductDetailWorkspace,
    Storyboard,
    UserDesignSkill,
    UserDesignSkillPatch,
} from "@/types/product-detail";

type EditableSkillPatch = Partial<Omit<UserDesignSkill, "brand" | "copy" | "layout">> & {
    brand?: Partial<UserDesignSkill["brand"]>;
    copy?: Partial<UserDesignSkill["copy"]>;
    layout?: Partial<UserDesignSkill["layout"]>;
};

type ProductDetailStore = {
    workspace: ProductDetailWorkspace;
    loading: boolean;
    saving: boolean;
    error: string;
    load: () => Promise<void>;
    createProject: (name: string, platform: ProductDetailPlatform) => string;
    selectProject: (projectId: string) => void;
    deleteProject: (projectId: string) => void;
    updateProject: (projectId: string, updater: (project: ProductDetailProject) => ProductDetailProject) => void;
    updateBrief: (projectId: string, patch: ProductBriefPatch) => void;
    setProjectStatus: (projectId: string, status: ProductDetailProjectStatus) => void;
    appendMessage: (projectId: string, message: ProductDetailConversationMessage) => void;
    updateMessage: (projectId: string, messageId: string, patch: Partial<ProductDetailConversationMessage>) => void;
    setStoryboard: (projectId: string, storyboard: Storyboard) => void;
    confirmStoryboard: (projectId: string) => void;
    addAsset: (projectId: string, asset: ProductDetailAsset) => void;
    removeAsset: (projectId: string, assetId: string) => void;
    createSkill: (input?: EditableSkillPatch) => string;
    updateSkill: (skillId: string, patch: EditableSkillPatch) => void;
    deleteSkill: (skillId: string) => void;
    toggleSkill: (skillId: string, enabled: boolean) => void;
    saveProjectSkill: (projectId: string, patch?: UserDesignSkillPatch) => { id: string; created: boolean } | undefined;
    attachSkill: (projectId: string, skillId: string) => void;
    setProjectModel: (projectId: string, capability: "text" | "image", model: string) => void;
};

let saveQueue: Promise<void> = Promise.resolve();

function currentUserId() {
    const id = Number(useUserStore.getState().user?.id);
    return Number.isFinite(id) && id > 0 ? id : 0;
}

function briefContentKey(brief: ProductDetailProject["brief"]) {
    const { revision: _revision, ...content } = brief;
    return JSON.stringify(content);
}
function queueSave(workspace: ProductDetailWorkspace, set: (patch: Partial<ProductDetailStore>) => void) {
    set({ saving: true });
    saveQueue = saveQueue
        .then(() => saveProductDetailWorkspace(workspace))
        .catch((error) => {
            set({ error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => set({ saving: false }));
    return saveQueue;
}

export const useProductDetailStore = create<ProductDetailStore>((set, get) => ({
    workspace: createEmptyWorkspace(),
    loading: false,
    saving: false,
    error: "",
    load: async () => {
        set({ loading: true, error: "" });
        try {
            const workspace = await loadProductDetailWorkspace();
            const userId = currentUserId();
            const skills = ensureBuiltinSkills(workspace.skills, userId);
            let autoAttached = false;
            const enrichedWorkspace = {
                ...workspace,
                skills,
                projects: workspace.projects.map((project) => {
                    const skill = findBestSkill(skills, project);
                    const skillIds = project.skillIds.length ? project.skillIds : skill ? [skill.id] : [];
                    if (skillIds.length !== project.skillIds.length) autoAttached = true;
                    const nextProject = { ...project, skillIds };
                    if (!nextProject.storyboard) return nextProject;
                    return { ...nextProject, storyboard: ensureStoryboardVisualPrompts(nextProject.storyboard, nextProject.brief, skill || createEmptySkill(project.userId || userId)) };
                }),
            };
            set({ workspace: enrichedWorkspace, loading: false });
            if (autoAttached || JSON.stringify(skills) !== JSON.stringify(workspace.skills)) void queueSave(enrichedWorkspace, set);
        } catch (error) {
            set({ loading: false, error: error instanceof Error ? error.message : String(error) });
        }
    },
    createProject: (name, platform) => {
        const userId = currentUserId();
        const now = Date.now();
        const id = nanoid();
        const project: ProductDetailProject = {
            id,
            userId,
            name: name.trim() || "未命名详情页",
            status: "discovery",
            platform,
            brief: createEmptyBrief(platform),
            skillIds: [],
            conversationId: nanoid(),
            textModel: useConfigStore.getState().config.textModel,
            imageModel: useConfigStore.getState().config.imageModel,
            messages: [createProductDetailWelcomeMessage(now)],
            pageSpecs: [],
            assets: [],
            createdAt: now,
            updatedAt: now,
        };
        const workspace = upsertProject(get().workspace, project);
        set({ workspace, error: "" });
        void queueSave(workspace, set);
        return id;
    },
    selectProject: (projectId) => {
        const workspace = selectProject(get().workspace, projectId);
        set({ workspace });
        void queueSave(workspace, set);
    },
    deleteProject: (projectId) => {
        const workspace = removeProject(get().workspace, projectId);
        set({ workspace });
        void queueSave(workspace, set);
    },
    updateProject: (projectId, updater) => {
        const current = get().workspace.projects.find((item) => item.id === projectId);
        if (!current) return;
        const next = { ...updater(current), updatedAt: Date.now() };
        const workspace = upsertProject(get().workspace, next);
        set({ workspace });
        void queueSave(workspace, set);
    },
    updateBrief: (projectId, patch) => {
        const project = get().workspace.projects.find((item) => item.id === projectId);
        if (!project) return;
        const mergedBrief = mergeProductBrief(project.brief, patch);
        const matchedSkill = project.skillIds.length ? undefined : findBestSkill(get().workspace.skills, { ...project, brief: mergedBrief, skillIds: [] });
        const brief = matchedSkill ? applyDesignSkill(mergedBrief, matchedSkill) : mergedBrief;
        const contentChanged = briefContentKey(project.brief) !== briefContentKey(brief);
        const skillChanged = Boolean(matchedSkill && !project.skillIds.includes(matchedSkill.id));
        if (!contentChanged && !skillChanged) return;
        const previousProductName = project.brief.productName.trim();
        const nextProductName = brief.productName.trim();
        const canAutoRename = project.name === "新商品详情页" || (previousProductName && project.name === previousProductName);
        const name = canAutoRename && nextProductName ? nextProductName : project.name;
        get().updateProject(projectId, (current) => {
            const storyboard = contentChanged && current.storyboard ? {
                ...current.storyboard,
                status: "draft" as const,
                briefRevision: current.storyboard.briefRevision ?? current.brief.revision,
                warning: "关键信息已修改，需要重新生成分镜和页面图片。",
            } : current.storyboard;
            return {
                ...current,
                name,
                platform: brief.platform,
                brief,
                skillIds: matchedSkill ? Array.from(new Set([...current.skillIds, matchedSkill.id])) : current.skillIds,
                status: storyboard && contentChanged ? "storyboard_draft" : current.status,
                storyboard,
            };
        });
    },    setProjectStatus: (projectId, status) => {
        get().updateProject(projectId, (project) => ({ ...project, status }));
    },
    appendMessage: (projectId, message) => {
        get().updateProject(projectId, (project) => ({ ...project, messages: [...project.messages, message] }));
    },
    updateMessage: (projectId, messageId, patch) => {
        get().updateProject(projectId, (project) => ({
            ...project,
            messages: project.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
        }));
    },
    setStoryboard: (projectId, storyboard) => {
        get().updateProject(projectId, (project) => ({
            ...project,
            storyboard,
            status: storyboard.status === "confirmed" ? "storyboard_confirmed" : "storyboard_draft",
        }));
    },
    confirmStoryboard: (projectId) => {
        get().updateProject(projectId, (project) => {
            const storyboard = project.storyboard;
            if (!storyboard || storyboard.warning || !storyboard.pages.length || isStoryboardStale(storyboard, project.brief)) return project;
            return {
                ...project,
                storyboard: { ...storyboard, status: "confirmed", revision: storyboard.revision + 1 },
                status: "storyboard_confirmed",
            };
        });
    },
    removeAsset: (projectId, assetId) => {
        const project = get().workspace.projects.find((item) => item.id === projectId);
        if (!project) return;
        const productAssetIds = project.brief.productAssetIds.filter((id) => id !== assetId);
        const referenceAssetIds = project.brief.referenceAssetIds.filter((id) => id !== assetId);
        const briefReferencesAsset = productAssetIds.length !== project.brief.productAssetIds.length || referenceAssetIds.length !== project.brief.referenceAssetIds.length;
        get().updateProject(projectId, (current) => ({ ...current, assets: current.assets.filter((asset) => asset.id !== assetId) }));
        if (briefReferencesAsset) get().updateBrief(projectId, { productAssetIds, referenceAssetIds });
    },
    addAsset: (projectId, asset) => {
        get().updateProject(projectId, (project) => ({ ...project, assets: [...project.assets, asset] }));
    },
    createSkill: (input = {}) => {
        const base = createEmptySkill(currentUserId());
        const skill: UserDesignSkill = {
            ...base,
            ...input,
            id: input.id || nanoid(),
            brand: { ...base.brand, ...(input.brand || {}) },
            copy: { ...base.copy, ...(input.copy || {}) },
            layout: { ...base.layout, ...(input.layout || {}) },
            pagePatterns: input.pagePatterns || base.pagePatterns,
            categoryKnowledge: input.categoryKnowledge || base.categoryKnowledge,
            complianceRules: input.complianceRules || base.complianceRules,
            referenceAssetIds: input.referenceAssetIds || base.referenceAssetIds,
            sourceProjectIds: input.sourceProjectIds || base.sourceProjectIds,
        };
        const workspace = upsertSkill(get().workspace, skill);
        set({ workspace });
        void queueSave(workspace, set);
        return skill.id;
    },
    updateSkill: (skillId, patch) => {
        const skill = get().workspace.skills.find((item) => item.id === skillId);
        if (!skill) return;
        const next: UserDesignSkill = {
            ...skill,
            ...patch,
            brand: { ...skill.brand, ...(patch.brand || {}) },
            copy: { ...skill.copy, ...(patch.copy || {}) },
            layout: { ...skill.layout, ...(patch.layout || {}) },
            pagePatterns: patch.pagePatterns || skill.pagePatterns,
            categoryKnowledge: patch.categoryKnowledge || skill.categoryKnowledge,
            complianceRules: patch.complianceRules || skill.complianceRules,
            referenceAssetIds: patch.referenceAssetIds || skill.referenceAssetIds,
            revision: skill.revision + 1,
            updatedAt: Date.now(),
        };
        const workspace = upsertSkill(get().workspace, next);
        set({ workspace });
        void queueSave(workspace, set);
    },
    deleteSkill: (skillId) => {
        const workspace = removeSkill(get().workspace, skillId);
        set({ workspace });
        void queueSave(workspace, set);
    },
    toggleSkill: (skillId, enabled) => get().updateSkill(skillId, { enabled }),
    saveProjectSkill: (projectId, patch) => {
        const state = get();
        const project = state.workspace.projects.find((item) => item.id === projectId);
        if (!project) return undefined;
        const existing = state.workspace.skills.find((item) => project.skillIds.includes(item.id))
            || findBestSkill(state.workspace.skills, project);
        const skill = existing
            ? mergeLearnedSkill(existing, project, patch)
            : mergeSkillCandidate(buildSkillCandidate(project), patch);
        const nextProject = {
            ...project,
            skillIds: Array.from(new Set([...project.skillIds, skill.id])),
            updatedAt: Date.now(),
        };
        const workspace = upsertProject(upsertSkill(state.workspace, skill), nextProject);
        set({ workspace });
        void queueSave(workspace, set);
        return { id: skill.id, created: !existing };
    },
    setProjectModel: (projectId, capability, model) => {
        get().updateProject(projectId, (project) => capability === "text" ? { ...project, textModel: model } : { ...project, imageModel: model });
    },
    attachSkill: (projectId, skillId) => {
        const skill = get().workspace.skills.find((item) => item.id === skillId && item.enabled);
        if (!skill) return;
        get().updateProject(projectId, (project) => {
            const brief = applyDesignSkill(project.brief, skill);
            const briefChanged = briefContentKey(project.brief) !== briefContentKey(brief);
            const storyboard = briefChanged && project.storyboard
                ? { ...project.storyboard, status: "draft" as const, warning: "已应用新的设计 Skill，请重新生成分镜和页面图片。" }
                : project.storyboard;
            return {
                ...project,
                brief,
                skillIds: project.skillIds.includes(skillId) ? project.skillIds : [...project.skillIds, skillId],
                status: briefChanged && project.storyboard ? "storyboard_draft" : project.status,
                storyboard,
            };
        });
    },
}));
