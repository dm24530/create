import { nanoid } from "nanoid";

import type {
    ProductBrief,
    ProductPageRole,
    Storyboard,
    StoryboardPage,
    UserDesignSkill,
} from "@/types/product-detail";

const PAGE_ROLE_LABELS: Record<ProductPageRole, string> = {
    hero: "首屏主视觉",
    "pain-point": "痛点共鸣",
    "core-benefit": "核心利益",
    "feature-detail": "细节展示",
    scenario: "使用场景",
    "how-to-use": "使用方法",
    specification: "规格信息",
    trust: "信任信息",
    closing: "收尾转化",
};

const DEFAULT_ROLES: ProductPageRole[] = [
    "hero",
    "pain-point",
    "core-benefit",
    "feature-detail",
    "scenario",
    "specification",
    "closing",
];

const EXTRA_ROLES: ProductPageRole[] = ["how-to-use", "trust"];

export function createFallbackStoryboard(brief: ProductBrief, skill: UserDesignSkill): Storyboard {
    const roles = buildRoleSequence(brief, skill);
    const pages = roles.map((role, index) => createPage(role, index, brief, skill));
    return { id: nanoid(), revision: 1, status: "draft", pages: renumber(pages) };
}

export function createPage(role: ProductPageRole, index: number, brief: ProductBrief, skill: UserDesignSkill): StoryboardPage {
    const primaryPoint = brief.sellingPoints.find((item) => item.source !== "unconfirmed")?.text || "核心商品价值";
    const title = pageTitle(role, brief, primaryPoint);
    return {
        id: nanoid(),
        order: index + 1,
        role,
        title,
        message: pageMessage(role, brief, primaryPoint),
        copy: [
            { id: nanoid(), kind: "eyebrow", text: PAGE_ROLE_LABELS[role] },
            { id: nanoid(), kind: "title", text: title },
            { id: nanoid(), kind: "body", text: pageMessage(role, brief, primaryPoint) },
        ],
        visualPrompt: buildVisualPrompt(role, brief, skill),
        negativePrompt: [
            "不得生成任何文字",
            "不得生成水印、Logo 或认证标识",
            "不得改变商品外形、颜色、比例和结构",
        ],
        referenceAssetIds: [...brief.productAssetIds],
        factRefs: brief.sellingPoints.filter((item) => item.source !== "unconfirmed").slice(0, 2).map((item) => item.id),
        layoutTemplateId: skill.layout.preferredTemplates[0] || "clean-commerce",
        status: "draft",
    };
}

export function reorderStoryboard(storyboard: Storyboard, pageId: string, offset: number): Storyboard {
    const index = storyboard.pages.findIndex((page) => page.id === pageId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= storyboard.pages.length) return storyboard;
    const pages = [...storyboard.pages];
    [pages[index], pages[target]] = [pages[target], pages[index]];
    return { ...storyboard, revision: storyboard.revision + 1, pages: renumber(pages) };
}

export function updateStoryboardPage(storyboard: Storyboard, pageId: string, patch: Partial<StoryboardPage>): Storyboard {
    return {
        ...storyboard,
        revision: storyboard.revision + 1,
        pages: storyboard.pages.map((page) => page.id === pageId ? { ...page, ...patch, id: page.id, order: page.order } : page),
    };
}

export function normalizeStoryboard(value: unknown, brief: ProductBrief, skill: UserDesignSkill): Storyboard {
    if (!value || typeof value !== "object") return createFallbackStoryboard(brief, skill);
    const raw = value as Partial<Storyboard>;
    if (!Array.isArray(raw.pages) || raw.pages.length < 6) return createFallbackStoryboard(brief, skill);
    const pages = raw.pages.slice(0, 10).map((page, index) => ({
        ...page,
        id: typeof page.id === "string" ? page.id : nanoid(),
        order: index + 1,
        copy: Array.isArray(page.copy) ? page.copy : [],
        negativePrompt: Array.isArray(page.negativePrompt) ? page.negativePrompt : [],
        referenceAssetIds: Array.isArray(page.referenceAssetIds) ? page.referenceAssetIds : [...brief.productAssetIds],
        factRefs: Array.isArray(page.factRefs) ? page.factRefs : [],
        status: page.status || "draft",
    })) as StoryboardPage[];
    return {
        id: typeof raw.id === "string" ? raw.id : nanoid(),
        revision: Number(raw.revision) || 1,
        status: raw.status === "confirmed" ? "confirmed" : "draft",
        pages: renumber(pages),
    };
}

function buildRoleSequence(brief: ProductBrief, _skill: UserDesignSkill): ProductPageRole[] {
    const requested = Array.isArray(brief.requiredModules) ? brief.requiredModules : [];
    const sequence = requested.length ? [...requested] : [...DEFAULT_ROLES];
    if (!sequence.includes("hero")) sequence.unshift("hero");
    for (const role of EXTRA_ROLES) {
        if (sequence.length >= 8) break;
        if (role === "trust" && !hasTrustFact(brief)) continue;
        if (!sequence.includes(role)) sequence.push(role);
    }
    return sequence.slice(0, 10);
}

function renumber(pages: StoryboardPage[]) {
    return pages.map((page, index) => ({ ...page, order: index + 1 }));
}

function pageTitle(role: ProductPageRole, brief: ProductBrief, point: string) {
    const name = brief.productName || brief.category;
    if (role === "hero") return `${name} · ${point}`;
    if (role === "pain-point") return `告别${brief.targetAudience[0] || "日常"}的烦恼`;
    if (role === "core-benefit") return point;
    if (role === "feature-detail") return "看得见的细节";
    if (role === "scenario") return `适用于${brief.scenarios[0] || brief.targetAudience[0] || "多种场景"}`;
    if (role === "specification") return "规格与参数";
    if (role === "closing") return "现在就开始体验";
    return PAGE_ROLE_LABELS[role];
}

function pageMessage(role: ProductPageRole, brief: ProductBrief, point: string) {
    if (role === "hero") return `为${brief.targetAudience.join("、") || "目标用户"}打造的${brief.category || "商品"}。`;
    if (role === "pain-point") return `解决日常使用中的真实不便，让${brief.targetAudience.join("、") || "用户"}更轻松。`;
    if (role === "core-benefit") return point;
    if (role === "feature-detail") return "从材质、结构和使用方式呈现商品差异。";
    if (role === "scenario") return `适合${brief.scenarios.join("、") || "多种生活场景"}。`;
    if (role === "specification") return "以下信息需以用户确认的商品参数为准。";
    if (role === "closing") return `立即了解${brief.productName || "这款商品"}。`;
    return brief.description || point;
}

function buildVisualPrompt(role: ProductPageRole, brief: ProductBrief, skill: UserDesignSkill) {
    return [
        `商品详情页 ${PAGE_ROLE_LABELS[role]} 的无文字摄影底图`,
        `商品：${brief.productName}，类目：${brief.category}`,
        `保持商品外观一致，以用户商品图为唯一产品真值`,
        `视觉风格：${[...brief.visualStyle, ...skill.brand.visualTone].filter(Boolean).join("、") || "干净商业摄影"}`,
        `主色：${[...brief.colorPreference, ...skill.brand.colors].filter(Boolean).join("、") || "自然中性色"}`,
        "为后续文案排版留出清晰安全区",
        "不得生成任何文字、数字、徽章、水印或 UI",
    ].join("。");
}

function hasTrustFact(brief: ProductBrief) {
    return brief.sellingPoints.some((item) => item.source === "user" && /认证|检测|质保|专利|奖项/.test(item.text));
}
