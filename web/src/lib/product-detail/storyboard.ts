import { nanoid } from "nanoid";

import type {
    ProductBrief,
    ProductCopyBlock,
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

const PAGE_VISUAL_DIRECTIONS: Record<ProductPageRole, string> = {
    hero: "大画幅主视觉，产品占据画面中心或黄金分割位置，轮廓完整、材质清晰，背景简洁并预留标题安全区",
    "pain-point": "生活化叙事场景，用人物动作、环境和状态暗示使用中的痛点，产品作为自然出现的解决线索，不要做夸张前后对比",
    "core-benefit": "把核心利益转化为可感知的视觉细节，使用微距特写、材质纹理、水花、光线或动态痕迹突出产品能力，不添加功效文字",
    "feature-detail": "产品局部微距特写，重点呈现结构、接缝、材质、按键、接口或使用细节，使用侧光勾勒轮廓并保持商品比例准确",
    "scenario": "真实生活场景中的产品使用画面，人物与产品自然互动，交代空间、时间和使用方式，产品仍然是视觉焦点",
    "how-to-use": "连续步骤式构图，用三个清晰的动作片段或局部流程展示使用方法，步骤之间用空间留白分隔，不生成数字和说明文字",
    "specification": "规整的平铺或正视角构图，产品与必要配件有序排列，背景干净、比例明确，为后续规格文字留出稳定对齐区域",
    "trust": "克制的高品质细节和可靠感表达，使用包装、做工或使用结果作为视觉证据，不得生成认证标志、奖项徽章或虚构证明",
    closing: "氛围感收尾画面，产品置于画面一侧并留出大面积干净安全区，强调拥有感、生活方式和最终选择理由",
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

export const BRIEF_CHANGED_STORYBOARD_WARNING = "关键信息已修改，需要重新生成分镜和页面图片。";

const EXTRA_ROLES: ProductPageRole[] = ["how-to-use", "trust"];

export function isStoryboardStale(storyboard?: Storyboard, brief?: ProductBrief): boolean {
    if (!storyboard || !brief) return false;
    const storyboardRevision = Number(storyboard.briefRevision);
    const briefRevision = Number(brief.revision);
    if (!Number.isFinite(storyboardRevision) || !Number.isFinite(briefRevision)) return false;
    return storyboardRevision !== briefRevision;
}

export function keepStoryboardForEditing(storyboard: Storyboard, brief: ProductBrief): Storyboard {
    return {
        ...storyboard,
        status: "draft",
        briefRevision: brief.revision,
        warning: storyboard.warning === BRIEF_CHANGED_STORYBOARD_WARNING ? undefined : storyboard.warning,
    };
}
export function isStoryboardUsable(storyboard?: Storyboard, brief?: ProductBrief): boolean {
    return Boolean(storyboard && storyboard.status === "confirmed" && !storyboard.warning && !isStoryboardStale(storyboard, brief));
}

export function ensureStoryboardVisualPrompts(storyboard: Storyboard, brief: ProductBrief, skill: UserDesignSkill): Storyboard {
    let changed = false;
    const pages = storyboard.pages.map((page, index) => {
        const visualPrompt = enrichVisualPrompt(page, index, brief, skill);
        if (visualPrompt === page.visualPrompt) return page;
        changed = true;
        return { ...page, visualPrompt };
    });
    return changed ? { ...storyboard, pages } : storyboard;
}

export function createFallbackStoryboard(brief: ProductBrief, skill: UserDesignSkill): Storyboard {
    const roles = buildRoleSequence(brief, skill);
    const pages = roles.map((role, index) => createPage(role, index, brief, skill));
    return { id: nanoid(), revision: 1, status: "draft", pages: renumber(pages), briefRevision: brief.revision };
}

export function createPage(role: ProductPageRole, index: number, brief: ProductBrief, skill: UserDesignSkill): StoryboardPage {
    const primaryPoint = brief.sellingPoints.find((item) => item.source !== "unconfirmed")?.text || "核心商品价值";
    const title = pageTitle(role, brief, primaryPoint);
    const message = pageMessage(role, brief, primaryPoint);
    const copy: ProductCopyBlock[] = [
        { id: nanoid(), kind: "title" as const, text: title },
        { id: nanoid(), kind: "body" as const, text: message },
    ];
    if (role === "specification" || role === "feature-detail" || role === "trust") {
        const confirmedFacts = brief.sellingPoints.filter((item) => item.source !== "unconfirmed").slice(0, 5);
        copy.push(...confirmedFacts.map((item) => ({ id: nanoid(), kind: "spec" as const, text: item.text })));
    }
    if (role === "closing") {
        copy.push({ id: nanoid(), kind: "cta" as const, text: `了解${brief.productName || "这款商品"}` });
    }
    return {
        id: nanoid(),
        order: index + 1,
        role,
        title,
        message,
        copy,
        visualPrompt: buildVisualPrompt(role, brief, skill, title, message),
        negativePrompt: [
            "不得生成任何文字",
            "不得生成水印、Logo 或认证标识",
            "不得改变商品外形、颜色、比例和结构",
        ],
        referenceAssetIds: Array.from(new Set([...brief.productAssetIds, ...brief.referenceAssetIds])),
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
    return { ...storyboard, status: "draft", revision: storyboard.revision + 1, pages: renumber(pages) };
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
    const defaultReferenceIds = Array.from(new Set([...brief.productAssetIds, ...brief.referenceAssetIds]));
    const pages = raw.pages.slice(0, 10).map((page, index) => {
        const requestedReferences = Array.isArray(page.referenceAssetIds)
            ? Array.from(new Set(page.referenceAssetIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))))
            : [];
        return {
            ...page,
            id: typeof page.id === "string" ? page.id : nanoid(),
            order: index + 1,
            copy: Array.isArray(page.copy) ? page.copy : [],
            negativePrompt: Array.isArray(page.negativePrompt) ? page.negativePrompt : [],
            referenceAssetIds: requestedReferences.length ? requestedReferences : defaultReferenceIds,
            factRefs: Array.isArray(page.factRefs) ? page.factRefs : [],
            visualPrompt: enrichVisualPrompt(page, index, brief, skill),
            status: "draft",
            generatedAssetId: undefined,
            error: undefined,
        };
    }) as StoryboardPage[];
    return {
        id: typeof raw.id === "string" ? raw.id : nanoid(),
        revision: Number(raw.revision) || 1,
        status: "draft",
        pages: renumber(pages),
        briefRevision: brief.revision,
        warning: typeof raw.warning === "string" && raw.warning.trim() ? raw.warning.trim() : undefined,
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
    if (role === "how-to-use") return "轻松上手，几步完成";
    if (role === "trust") return "品质与使用保障";
    return "值得了解的商品细节";
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

function buildVisualPrompt(role: ProductPageRole, brief: ProductBrief, skill: UserDesignSkill, title = "", message = "") {
    const skillGuidance = skill.pagePatterns.find((pattern) => pattern.role === role)?.guidance || "";
    return [
        `商品详情页 ${PAGE_ROLE_LABELS[role]} 的无文字摄影底图`,
        title ? `本页主题：${title}` : "",
        message ? `本页内容：${message}` : "",
        `差异化构图：${PAGE_VISUAL_DIRECTIONS[role]}`,
        skillGuidance ? `品类页面经验：${skillGuidance}` : "",
        `商品：${brief.productName}，类目：${brief.category}`,
        `保持商品外观一致，以用户商品图为唯一产品真值`,
        `视觉风格：${[...brief.visualStyle, ...skill.brand.visualTone].filter(Boolean).join("、") || "干净商业摄影"}`,
        `主色：${[...brief.colorPreference, ...skill.brand.colors].filter(Boolean).join("、") || "自然中性色"}`,
        "本页提示词必须与前后页面在场景、构图、镜头和产品呈现方式上明显不同",
        "为后续文案排版留出清晰安全区",
        "不得生成任何文字、数字、徽章、水印或 UI",
    ].filter(Boolean).join("。");
}

function enrichVisualPrompt(page: StoryboardPage, index: number, brief: ProductBrief, skill: UserDesignSkill) {
    const direction = PAGE_VISUAL_DIRECTIONS[page.role] || PAGE_VISUAL_DIRECTIONS["core-benefit"];
    const original = typeof page.visualPrompt === "string" ? page.visualPrompt.trim() : "";
    const pageMarker = `第 ${index + 1} 页｜`;
    const skillGuidance = skill.pagePatterns.find((pattern) => pattern.role === page.role)?.guidance || "";
    if (original.includes(pageMarker) && original.includes(direction) && original.includes("不得复用其他页面") && (!skillGuidance || original.includes(skillGuidance))) return original;
    const title = safePageText(page.title) || PAGE_ROLE_LABELS[page.role] || `第 ${index + 1} 页`;
    const message = safePageText(page.message);
    const context = [
        `${pageMarker}${PAGE_ROLE_LABELS[page.role] || page.role}｜${title}`,
        message ? `本页内容：${message}` : "",
        original.includes(direction) ? "" : `本页差异化构图：${direction}`,
        skillGuidance && !original.includes(skillGuidance) ? `品类页面经验：${skillGuidance}` : "",
        `商品：${brief.productName || "当前商品"}；保持商品外观与用户商品图一致`,
        `视觉风格：${[...brief.visualStyle, ...skill.brand.visualTone].filter(Boolean).join("、") || "干净商业摄影"}`,
        "不得复用其他页面的场景和构图，不得生成文字、数字、徽章、水印或 UI",
    ].filter(Boolean);
    return [original, ...context].filter(Boolean).join("\n");
}

function safePageText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function hasTrustFact(brief: ProductBrief) {
    return brief.sellingPoints.some((item) => item.source === "user" && /认证|检测|质保|专利|奖项/.test(item.text));
}

export function resolveStoryboardGenerationStatus(pages: StoryboardPage[]): "review" | "failed" {
    return pages.length > 0 && pages.every((page) => Boolean(page.generatedAssetId)) ? "review" : "failed";
}
