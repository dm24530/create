import localforage from "localforage";

import { scopedCanvasStoreName } from "@/lib/canvas-storage-scope";
import { normalizeWorkspace } from "@/lib/product-detail/workspace";
import { resolveImageUrl } from "@/services/image-storage";
import type { ProductDetailAsset, ProductDetailWorkspace } from "@/types/product-detail";

const store = localforage.createInstance({
    name: "infinite-canvas",
    storeName: scopedCanvasStoreName("product_detail_workbench"),
});
const WORKSPACE_KEY = "workspace";

function serializableWorkspace(workspace: ProductDetailWorkspace): ProductDetailWorkspace {
    return {
        ...workspace,
        projects: workspace.projects.map((project) => ({
            ...project,
            assets: project.assets.map(({ url: _url, ...asset }) => asset),
        })),
    };
}

export async function loadProductDetailWorkspace(): Promise<ProductDetailWorkspace> {
    const stored = normalizeWorkspace(await store.getItem<unknown>(WORKSPACE_KEY));
    const projects = await Promise.all(stored.projects.map(async (project) => ({
        ...project,
        assets: await Promise.all(project.assets.map(async (asset): Promise<ProductDetailAsset> => ({
            ...asset,
            url: asset.storageKey ? await resolveImageUrl(asset.storageKey, asset.url || "") : asset.url,
        }))),
    })));
    return { ...stored, projects };
}

export async function saveProductDetailWorkspace(workspace: ProductDetailWorkspace): Promise<void> {
    await store.setItem(WORKSPACE_KEY, serializableWorkspace({ ...workspace, updatedAt: Date.now() }));
}

export async function clearProductDetailWorkspace(): Promise<void> {
    await store.removeItem(WORKSPACE_KEY);
}
