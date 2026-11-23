import { nanoid } from "nanoid";

import { PRODUCT_DETAIL_PLATFORM_PROFILES } from "@/lib/product-detail/defaults";
import type { PageLayer, PageSpec, ProductBrief, ProductDetailPlatform, StoryboardPage, TextStyle, UserDesignSkill, ValidationResult } from "@/types/product-detail";

const SAFE_MARGIN = 56;
const PAGE_BACKGROUND = "#f7f7f5";
const IMAGE_BACKGROUND = "#f0f0ee";
const INK = "#211f1b";
const BODY_INK = "rgba(33,31,27,0.86)";
const MUTED_INK = "rgba(33,31,27,0.56)";
const CARD_BACKGROUND = "rgba(255,255,255,0.84)";
const CJK_FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Source Han Sans SC", sans-serif';
const INTERNAL_LABELS = new Set([
    "首屏主视觉", "首屏", "痛点共鸣", "痛点", "核心利益", "利益", "细节展示", "细节",
    "使用场景", "场景", "使用方法", "使用步骤", "步骤", "规格信息", "规格", "信任信息",
    "信任", "收尾转化", "收尾", "产品详情页", "商品详情页",
]);

const LAYOUT: Record<StoryboardPage["role"], { height: number; imageHeight: number }> = {
    hero: { height: 1020, imageHeight: 500 },
    "pain-point": { height: 940, imageHeight: 480 },
    "core-benefit": { height: 940, imageHeight: 480 },
    "feature-detail": { height: 980, imageHeight: 520 },
    scenario: { height: 960, imageHeight: 500 },
    "how-to-use": { height: 980, imageHeight: 520 },
    specification: { height: 1040, imageHeight: 440 },
    trust: { height: 980, imageHeight: 460 },
    closing: { height: 920, imageHeight: 480 },
};

type CopyBundle = { eyebrow: string; title: string; body: string; specs: string[]; cta: string };

export function buildPageSpec(page: StoryboardPage, brief: ProductBrief, skill: UserDesignSkill, platform: ProductDetailPlatform): PageSpec {
    const profile = PRODUCT_DETAIL_PLATFORM_PROFILES[platform];
    const width = profile.width;
    const metrics = LAYOUT[page.role] || LAYOUT["core-benefit"];
    const height = metrics.height;
    const imageHeight = metrics.imageHeight;
    const copy = extractCopy(page);
    const template = resolveTemplate(page, skill);
    const centered = template.includes("editorial") || template.includes("centered");
    const accent = accentColor(brief, skill);
    const fontFamily = resolveFontFamily(skill.brand.fonts[0]);
    const layers: PageLayer[] = [];

    layers.push({ type: "shape", fill: IMAGE_BACKGROUND, radius: 0, rect: { x: 0, y: 0, width, height: imageHeight } });
    if (page.generatedAssetId) layers.push({ type: "image", assetId: page.generatedAssetId, rect: { x: 0, y: 0, width, height: imageHeight }, fit: "contain" });
    layers.push({ type: "shape", fill: PAGE_BACKGROUND, radius: 0, rect: { x: 0, y: imageHeight, width, height: height - imageHeight } });
    layers.push({ type: "shape", fill: accent, radius: 999, rect: { x: SAFE_MARGIN, y: imageHeight + 28, width: 54, height: 6 } });

    if (page.role === "specification") addSpecificationLayout(layers, page, copy, brief, width, height, imageHeight, accent, fontFamily, centered);
    else if (page.role === "trust") addTrustLayout(layers, copy, width, height, imageHeight, accent, fontFamily, centered);
    else if (page.role === "closing") addClosingLayout(layers, copy, width, height, imageHeight, accent, fontFamily, centered);
    else addEditorialLayout(layers, page, copy, width, height, imageHeight, accent, fontFamily, centered);

    const pending: PageSpec = { id: nanoid(), pageId: page.id, width, height, background: PAGE_BACKGROUND, layers, overflowStatus: "ok", validation: [] };
    const validation = validatePageSpec(pending);
    return { ...pending, overflowStatus: validation.some((item) => item.severity === "error") ? "error" : validation.some((item) => item.severity === "warning") ? "warning" : "ok", validation };
}

function addEditorialLayout(layers: PageLayer[], page: StoryboardPage, copy: CopyBundle, width: number, height: number, top: number, accent: string, fontFamily: string, centered: boolean) {
    const align: TextStyle["align"] = centered ? "center" : "left";
    const x = SAFE_MARGIN;
    const contentWidth = width - x * 2;
    const hasEyebrow = Boolean(copy.eyebrow);
    addText(layers, copy.eyebrow, { x, y: top + 58, width: contentWidth, height: 32 }, textStyle(18, 700, 27, accent, align, fontFamily));
    addText(layers, copy.title, { x, y: top + (hasEyebrow ? 102 : 66), width: contentWidth, height: page.role === "hero" ? 116 : 100 }, textStyle(page.role === "hero" ? 48 : 38, 700, page.role === "hero" ? 60 : 50, INK, align, fontFamily));
    addText(layers, copy.body, { x, y: top + (hasEyebrow ? 226 : 184), width: contentWidth, height: 82 }, textStyle(22, 500, 33, BODY_INK, align, fontFamily));
    if (copy.specs.length) addSpecRows(layers, copy.specs.slice(0, 3), { x, y: height - 118, width: contentWidth, height: 92 }, accent, fontFamily, centered);
}

function addSpecificationLayout(layers: PageLayer[], page: StoryboardPage, copy: CopyBundle, brief: ProductBrief, width: number, height: number, top: number, accent: string, fontFamily: string, centered: boolean) {
    const align: TextStyle["align"] = centered ? "center" : "left";
    const x = SAFE_MARGIN;
    const contentWidth = width - x * 2;
    const hasEyebrow = Boolean(copy.eyebrow);
    addText(layers, copy.eyebrow, { x, y: top + 54, width: contentWidth, height: 32 }, textStyle(18, 700, 27, accent, align, fontFamily));
    addText(layers, copy.title, { x, y: top + (hasEyebrow ? 96 : 62), width: contentWidth, height: 92 }, textStyle(40, 700, 50, INK, align, fontFamily));
    addText(layers, copy.body, { x, y: top + (hasEyebrow ? 198 : 164), width: contentWidth, height: 62 }, textStyle(21, 500, 31, BODY_INK, align, fontFamily));
    const factSpecs = page.factRefs.map((id) => brief.sellingPoints.find((item) => item.id === id)?.text).filter((text): text is string => Boolean(text));
    const specs = copy.specs.length ? copy.specs : factSpecs.length ? factSpecs : ["参数待用户确认"];
    addSpecRows(layers, specs.slice(0, 6), { x, y: top + (hasEyebrow ? 278 : 244), width: contentWidth, height: Math.min(300, Math.max(72, specs.slice(0, 6).length * 50)) }, accent, fontFamily, centered);
}

function addTrustLayout(layers: PageLayer[], copy: CopyBundle, width: number, height: number, top: number, accent: string, fontFamily: string, centered: boolean) {
    const align: TextStyle["align"] = centered ? "center" : "left";
    const x = SAFE_MARGIN;
    const contentWidth = width - x * 2;
    const hasEyebrow = Boolean(copy.eyebrow);
    addText(layers, copy.eyebrow, { x, y: top + 54, width: contentWidth, height: 32 }, textStyle(18, 700, 27, accent, align, fontFamily));
    addText(layers, copy.title, { x, y: top + (hasEyebrow ? 96 : 62), width: contentWidth, height: 90 }, textStyle(38, 700, 48, INK, align, fontFamily));
    addText(layers, copy.body, { x, y: top + (hasEyebrow ? 198 : 164), width: contentWidth, height: 76 }, textStyle(21, 500, 31, BODY_INK, align, fontFamily));
    if (copy.specs.length) addSpecRows(layers, copy.specs.slice(0, 4), { x, y: top + (hasEyebrow ? 286 : 252), width: contentWidth, height: 180 }, accent, fontFamily, centered);
}

function addClosingLayout(layers: PageLayer[], copy: CopyBundle, width: number, height: number, top: number, accent: string, fontFamily: string, centered: boolean) {
    const align: TextStyle["align"] = centered ? "center" : "left";
    const x = SAFE_MARGIN;
    const contentWidth = width - x * 2;
    const hasEyebrow = Boolean(copy.eyebrow);
    addText(layers, copy.eyebrow, { x, y: top + 54, width: contentWidth, height: 30 }, textStyle(18, 700, 27, accent, align, fontFamily));
    addText(layers, copy.title, { x, y: top + (hasEyebrow ? 94 : 62), width: contentWidth, height: 96 }, textStyle(44, 700, 56, INK, align, fontFamily));
    addText(layers, copy.body, { x, y: top + (hasEyebrow ? 200 : 168), width: contentWidth, height: 70 }, textStyle(21, 500, 31, BODY_INK, align, fontFamily));
    const cta = copy.cta || "了解详情";
    layers.push({ type: "shape", fill: accent, radius: 999, rect: { x, y: height - 100, width: Math.min(292, contentWidth), height: 58 } });
    addText(layers, cta, { x: x + 28, y: height - 88, width: Math.min(236, contentWidth - 56), height: 36 }, textStyle(20, 700, 29, contrastText(accent), "left", fontFamily));
}

function addSpecRows(layers: PageLayer[], specs: string[], rect: { x: number; y: number; width: number; height: number }, accent: string, fontFamily: string, centered: boolean) {
    const rows = Math.max(1, Math.min(7, specs.length));
    const rowHeight = Math.min(58, Math.floor(rect.height / rows));
    specs.slice(0, rows).forEach((spec, index) => {
        const y = rect.y + index * rowHeight;
        layers.push({ type: "shape", fill: CARD_BACKGROUND, radius: 14, rect: { x: rect.x, y, width: rect.width, height: rowHeight - 8 } });
        layers.push({ type: "shape", fill: accent, radius: 999, rect: { x: rect.x + 18, y: y + rowHeight / 2 - 3, width: 6, height: 6 } });
        addText(layers, spec, { x: rect.x + 38, y: y + 8, width: rect.width - 56, height: rowHeight - 16 }, textStyle(19, 600, 28, INK, centered ? "center" : "left", fontFamily));
    });
}

function addText(layers: PageLayer[], text: string, rect: { x: number; y: number; width: number; height: number }, style: TextStyle) {
    if (!text.trim()) return;
    layers.push({ type: "text", text: text.trim(), style, rect });
}

function textStyle(fontSize: number, fontWeight: number, lineHeight: number, color: string, align: TextStyle["align"], fontFamily: string): TextStyle {
    return { fontFamily, fontSize, fontWeight, lineHeight, color, align };
}

function extractCopy(page: StoryboardPage): CopyBundle {
    const first = (kind: StoryboardPage["copy"][number]["kind"]) => page.copy.find((item) => item.kind === kind)?.text?.trim() || "";
    const specs = page.copy.filter((item) => item.kind === "spec").flatMap((item) => item.text.split(/\n+/).map((value) => sanitizeCustomerText(value)).filter(Boolean));
    const rawTitle = first("title") || page.title;
    const rawBody = first("body") || page.message;
    return {
        eyebrow: sanitizeCustomerText(first("eyebrow")),
        title: sanitizeCustomerText(rawTitle),
        body: sanitizeCustomerText(rawBody),
        specs,
        cta: sanitizeCustomerText(first("cta")),
    };
}

export function sanitizeCustomerText(value: string) {
    let text = String(value || "").trim();
    text = text.replace(/^(?:P(?:AGE)?\s*\d+|第\s*\d+\s*(?:页|张|屏)|图片\s*\d+|\d+\s*号图片)\s*[｜|:：.\-、]?\s*/i, "").trim();
    text = text.replace(/^\d+\s*[.、:：|｜\-]\s*/, "").trim();
    text = text.replace(/^(?:编码|编号|页面编号|图片编号)\s*[:：]\s*[^｜|:：\s]+\s*[｜|:：\-]?\s*/i, "").trim();
    for (const label of INTERNAL_LABELS) {
        if (text === label) return "";
        const prefix = `${label}｜`;
        const prefixPipe = `${label}|`;
        if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
        if (text.startsWith(prefixPipe)) return text.slice(prefixPipe.length).trim();
    }
    return text;
}

function resolveFontFamily(value?: string) {
    const requested = String(value || "").trim();
    if (!requested || /^(?:ui-sans-serif|system-ui|sans-serif)$/i.test(requested)) return CJK_FONT_STACK;
    const quoted = requested.includes(",")
        ? requested
        : /^[\w-]+$/.test(requested) ? requested : `"${requested.replace(/"/g, "")}"`;
    return `${quoted}, ${CJK_FONT_STACK}`;
}

function resolveTemplate(page: StoryboardPage, skill: UserDesignSkill) {
    const preferred = skill.layout.preferredTemplates.find(Boolean);
    return String(page.layoutTemplateId || preferred || "clean-commerce").toLowerCase();
}

export function validatePageSpec(spec: PageSpec): ValidationResult[] {
    const result: ValidationResult[] = [];
    if (!spec.layers.some((layer) => layer.type === "image")) result.push({ severity: "error", code: "missing_image", message: "当前页面没有已完成的原图底图。" });
    for (const layer of spec.layers) {
        if (layer.rect.width <= 0 || layer.rect.height <= 0) result.push({ severity: "error", code: "invalid_rect", message: "存在无效的图层尺寸。" });
        if (layer.rect.x < 0 || layer.rect.y < 0 || layer.rect.x + layer.rect.width > spec.width || layer.rect.y + layer.rect.height > spec.height) result.push({ severity: "error", code: "layer_out_of_bounds", message: "存在超出页面的图层。" });
        if (layer.type === "text" && !layer.text.trim()) result.push({ severity: "error", code: "empty_text", message: "存在空文本图层。" });
        if (layer.type === "text") {
            const estimatedLines = estimateWrappedLineCount(layer.text, layer.rect.width, layer.style.fontSize);
            const maxLines = Math.max(1, Math.floor(layer.rect.height / (layer.style.lineHeight || layer.style.fontSize * 1.35)));
            if (estimatedLines > maxLines) result.push({ severity: "error", code: "text_overflow", message: `文本“${layer.text.slice(0, 24)}”可能超出安全区域。`, field: layer.text });
            else if (estimatedLines === maxLines && estimatedLines > 1) result.push({ severity: "warning", code: "text_near_limit", message: `文本“${layer.text.slice(0, 24)}”接近高度上限。`, field: layer.text });
        }
    }
    return result;
}

export function estimateWrappedLineCount(text: string, maxWidth: number, fontSize: number) {
    const safeWidth = Math.max(1, maxWidth);
    let total = 0;
    for (const paragraph of String(text || "").split(/\n/)) {
        if (!paragraph.trim()) { total += 1; continue; }
        let lineWidth = 0;
        let lines = 1;
        for (const character of paragraph) {
            const width = characterWidth(character, fontSize);
            if (lineWidth > 0 && lineWidth + width > safeWidth) { lines += 1; lineWidth = width; }
            else lineWidth += width;
        }
        total += lines;
    }
    return Math.max(1, total);
}

function characterWidth(character: string, fontSize: number) {
    if (/\s/.test(character)) return fontSize * 0.34;
    if (/[\u2e80-\uffff]/.test(character)) return fontSize;
    if (/[A-Z0-9]/.test(character)) return fontSize * 0.62;
    return fontSize * 0.55;
}

export function accentColor(brief: ProductBrief, skill: UserDesignSkill) { return brief.colorPreference[0] || skill.brand.colors[0] || "#7a7a76"; }

function contrastText(color: string) {
    const match = color.match(/^#([0-9a-f]{6})$/i);
    if (!match) return "#ffffff";
    const value = parseInt(match[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#111827" : "#ffffff";
}