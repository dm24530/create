import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import { legacyCanvasStorageKeys, scopedCanvasStorageKey } from "@/lib/canvas-storage-scope";
import { sanitizeCanvasMediaValue } from "@/lib/canvas/canvas-media-url";
import { canvasAssetFolderName } from "@/lib/canvas/canvas-asset-folder";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    nodeCount?: number;
    connectionCount?: number;
    cloudVersion?: number;
    cloudSyncedAt?: string;
    cloudVersionUncertain?: boolean;
    cloudSyncedFingerprint?: string;
    assetFolder?: string;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const LEGACY_CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
const CANVAS_STORE_KEY = scopedCanvasStorageKey(LEGACY_CANVAS_STORE_KEY);
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let pendingPersistWrite: { name: string; value: string } | null = null;

export function flushCanvasStorePersistence() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (!pendingPersistWrite) return;
    const pending = pendingPersistWrite;
    pendingPersistWrite = null;
    writeLocalStorageBackup(pending.name, pending.value);
    void localForageStorage.setItem(pending.name, pending.value);
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        let value = await localForageStorage.getItem(name);
        const backup = readLocalStorageBackup(name);
        if (backup && persistedStateFreshness(backup) > persistedStateFreshness(value)) {
            value = backup;
        }
        if (!value) {
            let migratedFrom = "";
            for (const legacyKey of legacyCanvasStorageKeys(LEGACY_CANVAS_STORE_KEY)) {
                value = await localForageStorage.getItem(legacyKey);
                if (value) {
                    migratedFrom = legacyKey;
                    break;
                }
            }
            if (value) {
                writeLocalStorageBackup(name, value);
                await localForageStorage.setItem(name, value);
                if (migratedFrom) await localForageStorage.removeItem(migratedFrom);
            }
        }
        if (value) {
            for (const legacyKey of legacyCanvasStorageKeys(LEGACY_CANVAS_STORE_KEY)) {
                await localForageStorage.removeItem(legacyKey);
            }
        }
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        pendingPersistWrite = { name, value: JSON.stringify(value) };
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            flushCanvasStorePersistence();
        }, 100);
    },
    removeItem: (name) => {
        if (typeof window !== "undefined") {
            try {
                window.localStorage.removeItem(name);
            } catch {
                // Ignore storage cleanup failures; IndexedDB cleanup below remains authoritative.
            }
        }
        return localForageStorage.removeItem(name);
    },
};

function readLocalStorageBackup(name: string) {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(name);
    } catch {
        return null;
    }
}

function writeLocalStorageBackup(name: string, value: string) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(name, value);
    } catch {
        // IndexedDB remains the primary store when the browser quota rejects the backup.
    }
}

function persistedStateFreshness(value: string | null) {
    if (!value) return 0;
    try {
        const state = (JSON.parse(value) as StorageValue<CanvasStore>).state;
        let newest = 0;
        for (const project of state.projects || []) {
            newest = Math.max(newest, Date.parse(project.updatedAt || "") || 0);
        }
        for (const project of state.deletedProjects || []) {
            newest = Math.max(newest, Date.parse(project.deletedAt || "") || 0);
        }
        return newest;
    } catch {
        return 0;
    }
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    assetFolder: canvasAssetFolderName(id, title),
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const title = source.title || i18n.t("canvas.project.imported");
                const project: CanvasProject = {
                    id,
                    title,
                    assetFolder: source.assetFolder || canvasAssetFolderName(id, title),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                }),
            replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            merge: (persisted, current) => {
                const state = (persisted || {}) as Partial<CanvasStore>;
                return {
                    ...current,
                    ...state,
                    projects: Array.isArray(state.projects)
                        ? state.projects.map((project) => ({
                            ...project,
                            assetFolder: project.assetFolder || canvasAssetFolderName(project.id, project.title),
                            nodes: Array.isArray(project.nodes)
                                ? project.nodes.map((node) => sanitizeCanvasMediaValue(node) as CanvasNodeData)
                                : project.nodes,
                        }))
                        : current.projects,
                };
            },
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
