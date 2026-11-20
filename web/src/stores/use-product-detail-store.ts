import { create } from "zustand";
import { nanoid } from "nanoid";

import { createEmptyBrief, createEmptySkill, createEmptyWorkspace } from "@/lib/product-detail/defaults";
import { mergeProductBrief } from "@/lib/product-detail/brief";
import { removeProject, removeSkill, selectProject, upsertProject, upsertSkill } from "@/lib/product-detail/workspace";
import { loadProductDetailWorkspace, saveProductDetailWorkspace } from "@/services/product-detail/storage";
import { useUserStore } from "@/stores/use-user-store";
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
} from "@/types/product-detail";

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
    createSkill: (input?: Partial<UserDesignSkill>) => string;
    updateSkill: (skillId: string, patch: Partial<UserDesignSkill>) => void;
    deleteSkill: (skillId: string) => void;
    toggleSkill: (skillId: string, enabled: boolean) => void;
    attachSkill: (projectId: string, skillId: string) => void;
};

let saveQueue: Promise<void> = Promise.resolve();

function currentUserId() {
    const id = Number(useUserStore.getState().user?.id);
    return Number.isFinite(id) && id > 0 ? id : 0;
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
            set({ workspace, loading: false });
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
            messages: [],
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
        const brief = mergeProductBrief(project.brief, patch);
        get().updateProject(projectId, (current) => ({ ...current, brief, status: "discovery" }));
    },
    setProjectStatus: (projectId, status) => {
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
        get().updateProject(projectId, (project) => project.storyboard ? ({
            ...project,
            storyboard: { ...project.storyboard, status: "confirmed", revision: project.storyboard.revision + 1 },
            status: "storyboard_confirmed",
        }) : project);
    },
    addAsset: (projectId, asset) => {
        get().updateProject(projectId, (project) => ({ ...project, assets: [...project.assets, asset] }));
    },
    createSkill: (input = {}) => {
        const skill = { ...createEmptySkill(currentUserId()), ...input, id: input.id || nanoid() };
        const workspace = upsertSkill(get().workspace, skill);
        set({ workspace });
        void queueSave(workspace, set);
        return skill.id;
    },
    updateSkill: (skillId, patch) => {
        const skill = get().workspace.skills.find((item) => item.id === skillId);
        if (!skill) return;
        const workspace = upsertSkill(get().workspace, { ...skill, ...patch, revision: skill.revision + 1, updatedAt: Date.now() });
        set({ workspace });
        void queueSave(workspace, set);
    },
    deleteSkill: (skillId) => {
        const workspace = removeSkill(get().workspace, skillId);
        set({ workspace });
        void queueSave(workspace, set);
    },
    toggleSkill: (skillId, enabled) => get().updateSkill(skillId, { enabled }),
    attachSkill: (projectId, skillId) => {
        get().updateProject(projectId, (project) => ({
            ...project,
            skillIds: project.skillIds.includes(skillId) ? project.skillIds : [...project.skillIds, skillId],
        }));
    },
}));
