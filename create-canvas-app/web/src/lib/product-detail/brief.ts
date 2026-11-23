import type {
    ProductBrief,
    ProductBriefPatch,
    ProductDetailPlatform,
    ProductFactItem,
    ProductPageRole,
} from "@/types/product-detail";
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

const STRING_FIELDS = ["productName", "category", "description"] as const satisfies readonly (keyof ProductBrief)[];
const STRING_ARRAY_FIELDS = [
    "targetAudience",
    "scenarios",
    "visualStyle",
    "colorPreference",
    "copyTone",
    "forbiddenContent",
    "referenceAssetIds",
    "productAssetIds",
    "assumptions",
] as const satisfies readonly (keyof ProductBrief)[];
const PLATFORMS = new Set<ProductDetailPlatform>(["taobao", "tmall", "jd", "pdd"]);
const PRICE_POSITIONS = new Set<NonNullable<ProductBrief["pricePosition"]>>(["budget", "mid", "premium"]);
const PAGE_ROLES = new Set<ProductPageRole>([
    "hero",
    "pain-point",
    "core-benefit",
    "feature-detail",
    "scenario",
    "how-to-use",
    "specification",
    "trust",
    "closing",
]);
const BRIEF_FIELDS = new Set<keyof ProductBrief>([
    "productName",
    "category",
    "description",
    "sellingPoints",
    "targetAudience",
    "scenarios",
    "platform",
    "pricePosition",
    "visualStyle",
    "colorPreference",
    "copyTone",
    "forbiddenContent",
    "referenceAssetIds",
    "productAssetIds",
    "requiredModules",
    "assumptions",
    "revision",
]);

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

export function missingProductBriefFields(brief: ProductBrief): string[] {
    const missing: string[] = [];
    if (!brief.productName.trim()) missing.push("商品名称");
    if (!brief.category.trim()) missing.push("商品类目");
    if (!brief.targetAudience.some((item) => item.trim())) missing.push("目标人群");
    if (!brief.sellingPoints.some((item) => item.source !== "unconfirmed" && item.text.trim())) missing.push("核心卖点");
    return missing;
}

export function isProductBriefReady(brief: ProductBrief): boolean {
    return missingProductBriefFields(brief).length === 0;
}
export function briefWithPlatform(platform: ProductDetailPlatform): ProductBrief {
    return createEmptyBrief(platform);
}

export function isProductBriefField(value: unknown): value is keyof ProductBrief {
    return typeof value === "string" && BRIEF_FIELDS.has(value as keyof ProductBrief);
}

export function sanitizeProductBriefPatch(value: unknown): ProductBriefPatch | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const patch: ProductBriefPatch = {};

    for (const field of STRING_FIELDS) {
        if (typeof input[field] === "string") patch[field] = input[field].trim();
    }
    for (const field of STRING_ARRAY_FIELDS) {
        if (Array.isArray(input[field])) patch[field] = uniqueStrings(input[field]);
    }
    if (typeof input.platform === "string" && PLATFORMS.has(input.platform as ProductDetailPlatform)) {
        patch.platform = input.platform as ProductDetailPlatform;
    }
    if (typeof input.pricePosition === "string" && PRICE_POSITIONS.has(input.pricePosition as NonNullable<ProductBrief["pricePosition"]>)) {
        patch.pricePosition = input.pricePosition as NonNullable<ProductBrief["pricePosition"]>;
    }
    if (Array.isArray(input.sellingPoints)) {
        patch.sellingPoints = sanitizeFactItems(input.sellingPoints);
    }
    if (Array.isArray(input.requiredModules)) {
        patch.requiredModules = uniqueStrings(input.requiredModules).filter((item): item is ProductPageRole => PAGE_ROLES.has(item as ProductPageRole));
    }
    return Object.keys(patch).length ? patch : undefined;
}

function sanitizeFactItems(value: unknown[]): ProductFactItem[] {
    const seenText = new Set<string>();
    const seenIds = new Set<string>();
    const result: ProductFactItem[] = [];
    for (const [index, item] of value.entries()) {
        if (typeof item === "string") {
            const text = item.trim();
            if (!text || seenText.has(text)) continue;
            seenText.add(text);
            const id = `fact-${index + 1}`;
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            result.push({ id, text, source: "user" });
            continue;
        }
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const text = typeof record.text === "string" ? record.text.trim() : "";
        if (!text || seenText.has(text)) continue;
        seenText.add(text);
        const requestedId = typeof record.id === "string" ? record.id.trim() : "";
        let id = requestedId || `fact-${index + 1}`;
        if (seenIds.has(id)) id = `${id}-${index + 1}`;
        seenIds.add(id);
        const source = record.source === "user" || record.source === "visible" ? record.source : "unconfirmed";
        result.push({
            id,
            text,
            label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined,
            source,
        });
    }
    return result;
}

function uniqueStrings(value: unknown[]) {
    return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}
