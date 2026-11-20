import { nanoid } from "nanoid";

import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import type { PageLayer, PageSpec, ProductBrief, ProductDetailPlatform, StoryboardPage, UserDesignSkill, ValidationResult } from "@/types/product-detail";

const SAFE_MARGIN = 56;
const ROLE_HEIGHT: Record<StoryboardPage["role"], number> = {
    hero: 1120,
    "pain-point": 980,
    "core-benefit": 980,
    "feature-detail": 1040,
    scenario: 1040,
    "how-to-use": 1040,
    specification: 960,
    trust: 900,
    closing: 860,
};

export function buildPageSpec(page: StoryboardPage, brief: ProductBrief, skill: UserDesignSkill, platform: ProductDetailPlatform): PageSpec {
    const profile = PRODUCT_DETAIL_PLATFORM_PROFILES[platform];
    const width = profile.width;
    const height = ROLE_HEIGHT[page.role] || 1000;
    const layers: PageLayer[] = [];
    if (page.generatedAssetId) layers.push({ type: "image", assetId: page.generatedAssetId, rect: { x: 0, y: 0, width, height }, fit: "cover" });
    layers.push(
        { type: "gradient", colors: ["rgba(15,23,42,0.08)", "rgba(15,23,42,0.78)"], direction: "vertical", rect: { x: 0, y: 0, width, height } },
        { type: "shape", fill: accentColor(brief, skill), radius: 999, rect: { x: SAFE_MARGIN, y: SAFE_MARGIN, width: 54, height: 6 } },
        { type: "text", text: String(page.order).padStart(2, "0"), style: { fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 22, fontWeight: 700, lineHeight: 28, color: "rgba(255,255,255,0.76)", align: "left" }, rect: { x: SAFE_MARGIN, y: SAFE_MARGIN + 24, width: 100, height: 32 } },
        { type: "text", text: page.copy.find((item) => item.kind === "title")?.text || page.title, style: { fontFamily: "system-ui, sans-serif", fontSize: page.role === "hero" ? 52 : 42, fontWeight: 750, lineHeight: page.role === "hero" ? 64 : 54, color: "#ffffff", align: "left" }, rect: { x: SAFE_MARGIN, y: height - 360, width: width - SAFE_MARGIN * 2, height: 150 } },
        { type: "text", text: page.copy.find((item) => item.kind === "body")?.text || page.message, style: { fontFamily: "system-ui, sans-serif", fontSize: 24, fontWeight: 400, lineHeight: 36, color: "rgba(255,255,255,0.9)", align: "left" }, rect: { x: SAFE_MARGIN, y: height - 192, width: width - SAFE_MARGIN * 2, height: 110 } },
    );
    const validation = validatePageSpec({ id: "pending", pageId: page.id, width, height, background: "#0f172a", layers, overflowStatus: "ok", validation: [] });
    return { id: nanoid(), pageId: page.id, width, height, background: "#0f172a", layers, overflowStatus: validation.some((item) => item.severity === "error") ? "error" : validation.some((item) => item.severity === "warning") ? "warning" : "ok", validation };
}

export function validatePageSpec(spec: PageSpec): ValidationResult[] {
    const result: ValidationResult[] = [];
    if (!spec.layers.some((layer) => layer.type === "image")) result.push({ severity: "error", code: "missing_image", message: "当前页面没有已完成的原图底图。" });
    for (const layer of spec.layers) {
        if (layer.rect.width <= 0 || layer.rect.height <= 0) result.push({ severity: "error", code: "invalid_rect", message: "存在无效的图层尺寸。" });
        if (layer.rect.x < 0 || layer.rect.y < 0 || layer.rect.x + layer.rect.width > spec.width || layer.rect.y + layer.rect.height > spec.height) result.push({ severity: "error", code: "layer_out_of_bounds", message: "存在超出页面的图层。" });
        if (layer.type === "text" && !layer.text.trim()) result.push({ severity: "error", code: "empty_text", message: "存在空文本图层。" });
    }
    return result;
}

export function accentColor(brief: ProductBrief, skill: UserDesignSkill) { return brief.colorPreference[0] || skill.brand.colors[0] || "#f97316"; }
