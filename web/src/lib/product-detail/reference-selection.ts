import type { ProductDetailAsset, ProductDetailProject, StoryboardPage } from "@/types/product-detail";

export const MAX_STORYBOARD_REFERENCE_IMAGES = 8;
export const MAX_CONVERSATION_REFERENCE_IMAGES = 4;

export function hasProductImageReference(assets: ProductDetailAsset[]): boolean {
    return assets.some((asset) => asset.kind === "product");
}

export function prioritizeReferenceAssets(assets: ProductDetailAsset[], limit: number, productLimit = Math.max(1, Math.ceil(limit / 2))): ProductDetailAsset[] {
    const safeLimit = Math.max(0, limit);
    if (!safeLimit) return [];
    const seen = new Set<string>();
    const unique = (items: ProductDetailAsset[]) => items.filter((asset) => {
        if (seen.has(asset.id)) return false;
        seen.add(asset.id);
        return true;
    });
    const products = unique(assets.filter((asset) => asset.kind === "product"));
    const references = unique(assets.filter((asset) => asset.kind === "reference"));
    const selected = [...products.slice(0, Math.max(0, productLimit)), ...references].slice(0, safeLimit);
    if (selected.length < safeLimit) selected.push(...products.slice(productLimit, safeLimit - selected.length + productLimit));
    return selected.slice(0, safeLimit);
}

export function selectStoryboardReferenceAssets(
    project: ProductDetailProject,
    page: StoryboardPage,
): ProductDetailAsset[] {
    const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
    const selected: ProductDetailAsset[] = [];
    const seen = new Set<string>();
    const add = (asset: ProductDetailAsset | undefined) => {
        if (!asset || seen.has(asset.id) || selected.length >= MAX_STORYBOARD_REFERENCE_IMAGES) return;
        if (asset.kind !== "product" && asset.kind !== "reference") return;
        seen.add(asset.id);
        selected.push(asset);
    };

    // Product images must stay first so downstream prompts can distinguish product truth
    // from style or composition references.
    for (const id of project.brief.productAssetIds) add(assetsById.get(id));
    for (const id of page.referenceAssetIds) {
        const asset = assetsById.get(id);
        if (asset?.kind === "product") add(asset);
    }
    for (const asset of project.assets) {
        if (asset.kind === "product") add(asset);
    }
    for (const id of page.referenceAssetIds) {
        const asset = assetsById.get(id);
        if (asset?.kind === "reference") add(asset);
    }
    for (const id of project.brief.referenceAssetIds) add(assetsById.get(id));
    for (const asset of project.assets) {
        if (asset.kind === "reference") add(asset);
    }

    return selected;
}