import localforage from "localforage";

import { scopedCanvasStorageKey, scopedCanvasStoreName } from "@/lib/canvas-storage-scope";
import { normalizeWorkspace } from "@/lib/product-detail/workspace";
import { resolveImageUrl } from "@/services/image-storage";
import type { ProductDetailAsset, ProductDetailWorkspace, Storyboard } from "@/types/product-detail";

const store = localforage.createInstance({
    name: "infinite-canvas",
    storeName: scopedCanvasStoreName("product_detail_workbench"),
});
const WORKSPACE_KEY = "workspace";
const MIRROR_KEY = scopedCanvasStorageKey("product_detail_workbench:workspace");
const MIRROR_BYTE_LIMIT = 768 * 1024;
const MIRROR_MESSAGE_LIMIT = 50;
const MIRROR_PROJECT_LIMIT = 20;

function serializableWorkspace(workspace: ProductDetailWorkspace): ProductDetailWorkspace {
    return {
        ...workspace,
        projects: workspace.projects.map((project) => ({
            ...project,
            assets: project.assets.map(({ url: _url, ...asset }) => asset),
        })),
    };
}

function compactStoryboard(storyboard: Storyboard | undefined, promptLimit: number): Storyboard | undefined {
    if (!storyboard) return undefined;
    return {
        ...storyboard,
        pages: storyboard.pages.map((page) => ({
            ...page,
            copy: page.copy.slice(0, 8),
            negativePrompt: page.negativePrompt.slice(0, 6),
            visualPrompt: page.visualPrompt.slice(0, promptLimit),
        })),
    };
}

function compactWorkspace(workspace: ProductDetailWorkspace, limits: { projects: number; messages: number; prompt: number }): ProductDetailWorkspace {
    return serializableWorkspace({
        ...workspace,
        projects: workspace.projects.slice(0, limits.projects).map((project) => ({
            ...project,
            pageSpecs: [],
            messages: project.messages.slice(-limits.messages).map((message) => ({
                ...message,
                turn: message.turn ? { ...message.turn, storyboard: compactStoryboard(message.turn.storyboard, limits.prompt) } : undefined,
            })),
            storyboard: compactStoryboard(project.storyboard, limits.prompt),
        })),
    });
}

function serializedBytes(value: unknown) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function compactProductDetailWorkspaceForMirror(workspace: ProductDetailWorkspace): ProductDetailWorkspace {
    const attempts = [
        { projects: MIRROR_PROJECT_LIMIT, messages: MIRROR_MESSAGE_LIMIT, prompt: 800 },
        { projects: 10, messages: 20, prompt: 400 },
        { projects: 5, messages: 5, prompt: 200 },
        { projects: 1, messages: 0, prompt: 80 },
    ];
    let smallest = compactWorkspace(workspace, attempts[attempts.length - 1]);
    for (const limits of attempts) {
        const candidate = compactWorkspace(workspace, limits);
        if (serializedBytes(candidate) <= MIRROR_BYTE_LIMIT) return candidate;
        if (serializedBytes(candidate) < serializedBytes(smallest)) smallest = candidate;
    }
    return smallest;
}

function readMirrorWorkspace(): ProductDetailWorkspace | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(MIRROR_KEY);
        return raw ? normalizeWorkspace(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

function writeMirrorWorkspace(workspace: ProductDetailWorkspace) {
    if (typeof localStorage === "undefined") return;
    const compact = compactProductDetailWorkspaceForMirror(workspace);
    try {
        localStorage.setItem(MIRROR_KEY, JSON.stringify(compact));
        return;
    } catch {
        // Retry with the smallest recovery snapshot before falling back to IndexedDB only.
    }
    try {
        localStorage.removeItem(MIRROR_KEY);
        localStorage.setItem(MIRROR_KEY, JSON.stringify(compactWorkspace(workspace, { projects: 1, messages: 0, prompt: 80 })));
    } catch {
        // localforage remains the primary store when the synchronous mirror is full.
    }
}

async function hydrateWorkspace(workspace: ProductDetailWorkspace): Promise<ProductDetailWorkspace> {
    const projects = await Promise.all(workspace.projects.map(async (project) => ({
        ...project,
        assets: await Promise.all(project.assets.map(async (asset): Promise<ProductDetailAsset> => ({
            ...asset,
            url: asset.storageKey ? await resolveImageUrl(asset.storageKey, asset.url || "") : asset.url,
        }))),
    })));
    return { ...workspace, projects };
}

export async function loadProductDetailWorkspace(): Promise<ProductDetailWorkspace> {
    const indexedRaw = await store.getItem<unknown>(WORKSPACE_KEY).catch(() => null);
    const indexed = indexedRaw ? normalizeWorkspace(indexedRaw) : null;
    const mirror = readMirrorWorkspace();
    const hasIndexedData = Boolean(indexed && (indexed.projects.length || indexed.skills.length));
    const stored = hasIndexedData && indexed ? indexed : mirror || indexed || normalizeWorkspace(undefined);
    return hydrateWorkspace(stored);
}

export async function saveProductDetailWorkspace(workspace: ProductDetailWorkspace): Promise<void> {
    const snapshot = serializableWorkspace({ ...workspace, updatedAt: Date.now() });
    writeMirrorWorkspace(snapshot);
    await store.setItem(WORKSPACE_KEY, snapshot);
}

export async function clearProductDetailWorkspace(): Promise<void> {
    if (typeof localStorage !== "undefined") {
        try { localStorage.removeItem(MIRROR_KEY); } catch { /* best effort */ }
    }
    await store.removeItem(WORKSPACE_KEY);
}