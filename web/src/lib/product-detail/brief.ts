import type { ProductBrief, ProductBriefPatch, ProductDetailPlatform } from "@/types/product-detail";
import { createEmptyBrief } from "@/lib/product-detail/defaults";
export { createEmptyBrief } from "@/lib/product-detail/defaults";

const ARRAY_FIELDS = [
    "sellingPoints",
    "targetAudience",
    "scenarios",
    "visualStyle",
    "colorPreference",
    "copyTone",
    "forbiddenContent",
    "referenceAssetIds",
    "productAssetIds",
    "requiredModules",
    "assumptions",
] as const satisfies readonly (keyof ProductBrief)[];

export function mergeProductBrief(brief: ProductBrief, patch: ProductBriefPatch): ProductBrief {
    const next: ProductBrief = { ...brief, revision: brief.revision + 1 };
    for (const [key, value] of Object.entries(patch) as Array<[keyof ProductBrief, unknown]>) {
        if (key === "revision" || value === undefined) continue;
        if ((ARRAY_FIELDS as readonly string[]).includes(key) && Array.isArray(value)) {
            (next as unknown as Record<string, unknown>)[key] = [...value];
            continue;
        }
        (next as unknown as Record<string, unknown>)[key] = value;
    }
    return next;
}

export function isProductBriefReady(brief: ProductBrief): boolean {
    return Boolean(
        brief.productName.trim()
        && brief.category.trim()
        && brief.platform
        && brief.targetAudience.some((item) => item.trim())
        && brief.sellingPoints.some((item) => item.source !== "unconfirmed" && item.text.trim()),
    );
}

export function briefWithPlatform(platform: ProductDetailPlatform): ProductBrief {
    return createEmptyBrief(platform);
}

