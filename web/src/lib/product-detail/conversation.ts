import { nanoid } from "nanoid";

import { isProductBriefField, isProductBriefReady, sanitizeProductBriefPatch } from "@/lib/product-detail/brief";
import type { AiTextMessage } from "@/services/api/image";
import type {
    ProductBrief,
    ProductDetailAssistantTurn,
    ProductDetailConversationMessage,
    UserDesignSkill,
} from "@/types/product-detail";

const SYSTEM_PROMPT = `你是 Create 商品详情页工作台的策划 Agent。你的目标是通过简短多轮对话，帮助用户形成可执行的商品详情页 Brief，并在用户确认后调用页面动作。
规则：
1. 每轮最多问一个最关键的问题，不要重复询问已知信息。问题要具体，能提供 2-4 个短选项时放在 options 中。
2. 不要编造商品事实、尺寸、材质、认证、销量、评价、功效或售后承诺。
3. 能由用户确认的信息标记为 user；只能从图片直接看到的信息标记为 visible；推测标记为 unconfirmed。
4. 用户补充或推翻旧信息时，以最新消息为准，通过 briefPatch 覆盖对应字段；不要保留冲突的旧说法。
5. 用户只是提出设计想法时先记录，不要立即生成页面。信息足够时把 readyToPlan 设为 true，并建议 plan_storyboard 动作。
6. 你只能建议动作，不得声称已经生成、导出或保存。动作只能是 plan_storyboard、generate_all_images、open_results、open_export、save_skill。
7. 用户要求修改已有分镜时，返回完整的新 storyboard；不要只返回单页差异。新分镜保持 draft，等待用户确认。
8. platform 只能是 taobao、tmall、jd、pdd；pricePosition 只能是 budget、mid、premium。
9. 可以在 skillCandidate 中总结用户明确表达且可复用的品牌色、视觉风格、文案语气和禁用表达，但不得自动保存。
10. 必须只输出一个 JSON 对象，不要输出 Markdown 代码围栏或额外解释。
JSON 结构：
{"message":"给用户的简短回复","briefPatch":{},"question":{"field":"productName","prompt":"问题","options":[]},"readyToPlan":false,"assumptions":[],"risks":[],"skillCandidate":null,"storyboard":null,"actions":[]}`;

export function createProductDetailWelcomeMessage(createdAt = Date.now()): ProductDetailConversationMessage {
    const message = "先选择投放平台，也可以直接发商品图，或告诉我商品名称和类目。我会边聊边整理 Brief，信息够了再生成分镜。";
    return {
        id: nanoid(),
        role: "assistant",
        content: message,
        createdAt,
        turn: {
            message,
            question: {
                field: "platform",
                prompt: "这个详情页准备投放到哪个平台？",
                options: ["淘宝/天猫", "京东", "拼多多"],
            },
            readyToPlan: false,
            assumptions: [],
            risks: [],
        },
    };
}

export function parseProductDetailAssistantTurn(raw: string): ProductDetailAssistantTurn {
    try {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("missing json");
        const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
        const message = typeof parsed.message === "string" && parsed.message.trim()
            ? parsed.message.trim()
            : "请继续补充商品信息。";
        return {
            message,
            briefPatch: sanitizeProductBriefPatch(parsed.briefPatch),
            question: isRecord(parsed.question) && typeof parsed.question.prompt === "string" && isProductBriefField(parsed.question.field)
                ? {
                    field: parsed.question.field,
                    prompt: parsed.question.prompt.trim(),
                    options: sanitizeOptions(parsed.question.options),
                }
                : undefined,
            readyToPlan: parsed.readyToPlan === true,
            assumptions: stringArray(parsed.assumptions),
            risks: stringArray(parsed.risks),
            skillCandidate: isRecord(parsed.skillCandidate) ? parsed.skillCandidate : undefined,
            actions: parseActions(parsed.actions),
            storyboard: isRecord(parsed.storyboard) ? parsed.storyboard as ProductDetailAssistantTurn["storyboard"] : undefined,
        };
    } catch {
        return {
            message: "我刚刚没有重新整理好结构化信息，请再试一次。",
            readyToPlan: false,
            assumptions: [],
            risks: ["结构化输出解析失败"],
        };
    }
}

export function buildProductDetailConversationMessages(input: {
    brief: ProductBrief;
    messages: ProductDetailConversationMessage[];
    skill?: UserDesignSkill;
    userMessage?: string;
    attachments?: Array<{ dataUrl: string; type?: string; name?: string }>;
    storyboard?: import("@/types/product-detail").Storyboard;
}): AiTextMessage[] {
    const recent = input.messages.slice(-10).map((message): AiTextMessage => ({ role: message.role, content: message.content }));
    const system = [
        SYSTEM_PROMPT,
        `当前结构化 Brief：${JSON.stringify(input.brief)}`,
        input.skill ? `当前启用的用户设计 Skill：${JSON.stringify(skillPromptSummary(input.skill))}` : "当前没有启用用户 Skill。",
        input.storyboard ? `当前分镜：${JSON.stringify(input.storyboard)}` : "当前还没有分镜。",
        "用户随时可能补充、推翻或细化前文要求。请把最新一条用户消息视为当前意图，并更新结构化 Brief。",
        "如果用户要求修改分镜，请在 storyboard 字段返回完整的新分镜，不要只返回差异。",
    ].join("\n\n");
    return [
        { role: "system", content: system },
        ...recent,
        ...(input.userMessage ? [{
            role: "user" as const,
            content: input.attachments?.length
                ? [
                    { type: "text" as const, text: input.userMessage },
                    ...input.attachments.filter((item) => item.dataUrl).slice(0, 4).map((item) => ({ type: "image_url" as const, image_url: { url: item.dataUrl } })),
                ]
                : input.userMessage,
        }] : []),
    ];
}

export function fallbackProductDetailTurn(brief: ProductBrief): ProductDetailAssistantTurn {
    if (!brief.productName.trim()) return ask("productName", "请先告诉我商品名称。", ["我上传商品图", "我直接描述商品"]);
    if (!brief.category.trim()) return ask("category", "这个商品属于什么类目？", ["家居日用", "美妆个护", "食品饮料", "数码配件"]);
    if (!brief.targetAudience.length) return ask("targetAudience", "主要想卖给哪类人群？", ["通勤上班族", "年轻女性", "学生党", "家庭用户"]);
    if (!brief.sellingPoints.some((item) => item.source !== "unconfirmed")) return ask("sellingPoints", "请提供一个已确认的核心卖点。");
    return {
        message: "信息已经足够，可以生成页面分镜了。",
        readyToPlan: isProductBriefReady(brief),
        assumptions: [],
        risks: [],
        actions: isProductBriefReady(brief) ? [{ type: "plan_storyboard", label: "生成页面分镜" }] : undefined,
    };
}

function ask(field: keyof ProductBrief, prompt: string, options?: string[]): ProductDetailAssistantTurn {
    return {
        message: prompt,
        question: { field, prompt, options },
        readyToPlan: false,
        assumptions: [],
        risks: [],
    };
}

function skillPromptSummary(skill: UserDesignSkill) {
    return {
        name: skill.name,
        colors: skill.brand.colors,
        visualTone: skill.brand.visualTone,
        copyTone: skill.copy.tone,
        forbiddenPhrases: skill.copy.forbiddenPhrases,
        density: skill.copy.density,
        template: skill.layout.preferredTemplates,
    };
}

function parseActions(value: unknown): ProductDetailAssistantTurn["actions"] {
    if (!Array.isArray(value)) return undefined;
    const allowed = new Set(["plan_storyboard", "generate_all_images", "open_results", "open_export", "save_skill"]);
    const seen = new Set<string>();
    const actions: NonNullable<ProductDetailAssistantTurn["actions"]> = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        const type = String(item.type || "");
        if (!allowed.has(type) || seen.has(type)) continue;
        seen.add(type);
        actions.push({
            type: type as NonNullable<ProductDetailAssistantTurn["actions"]>[number]["type"],
            label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : undefined,
        });
    }
    return actions.length ? actions : undefined;
}

function sanitizeOptions(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const options = Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).slice(0, 4);
    return options.length ? options : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}
