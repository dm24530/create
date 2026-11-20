import { isProductBriefReady } from "@/lib/product-detail/brief";
import type { AiTextMessage } from "@/services/api/image";
import type {
    ProductBrief,
    ProductDetailAssistantTurn,
    ProductDetailConversationMessage,
    UserDesignSkill,
} from "@/types/product-detail";

const SYSTEM_PROMPT = `你是 Create 商品详情页工作台的策划助手。你的目标是通过简短多轮对话，帮助用户形成可执行的商品详情页 Brief。
规则：
1. 每轮最多问一个最关键的问题，不要重复询问已知信息。
2. 不要编造商品事实、尺寸、材质、认证、销量、评价、功效或售后承诺。
3. 能确认的信息标记为 user；只能从图片判断的信息标记为 visible；推测标记为 unconfirmed。
4. 用户只是提出设计想法时，先记录，不要立即生成页面。
5. 信息足够时把 readyToPlan 设为 true。
6. 必须只输出一个 JSON 对象，不要输出 Markdown 代码围栏或额外解释。
JSON 结构：
{"message":"给用户的简短回复","briefPatch":{},"question":{"field":"productName","prompt":"问题","options":[]},"readyToPlan":false,"assumptions":[],"risks":[],"skillCandidate":null}`;

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
            briefPatch: isRecord(parsed.briefPatch) ? parsed.briefPatch : undefined,
            question: isRecord(parsed.question) && typeof parsed.question.prompt === "string"
                ? {
                    field: String(parsed.question.field || "productName") as keyof ProductBrief,
                    prompt: parsed.question.prompt,
                    options: Array.isArray(parsed.question.options) ? parsed.question.options.map(String) : undefined,
                }
                : undefined,
            readyToPlan: parsed.readyToPlan === true,
            assumptions: stringArray(parsed.assumptions),
            risks: stringArray(parsed.risks),
            skillCandidate: isRecord(parsed.skillCandidate) ? parsed.skillCandidate : undefined,
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
}): AiTextMessage[] {
    const recent = input.messages.slice(-10).map((message): AiTextMessage => ({ role: message.role, content: message.content }));
    const system = [
        SYSTEM_PROMPT,
        `当前结构化 Brief：${JSON.stringify(input.brief)}`,
        input.skill ? `当前启用的用户设计 Skill：${JSON.stringify(skillPromptSummary(input.skill))}` : "当前没有启用用户 Skill。",
    ].join("\n\n");
    return [
        { role: "system", content: system },
        ...recent,
        ...(input.userMessage ? [{ role: "user" as const, content: input.userMessage }] : []),
    ];
}

export function fallbackProductDetailTurn(brief: ProductBrief): ProductDetailAssistantTurn {
    if (!brief.productName.trim()) return ask("productName", "请先告诉我商品名称。");
    if (!brief.category.trim()) return ask("category", "这个商品属于什么类目？");
    if (!brief.targetAudience.length) return ask("targetAudience", "主要想卖给哪类人群？");
    if (!brief.sellingPoints.some((item) => item.source !== "unconfirmed")) return ask("sellingPoints", "请提供一个已确认的核心卖点。");
    return {
        message: "信息已经足够，可以生成页面分镜了。",
        readyToPlan: isProductBriefReady(brief),
        assumptions: [],
        risks: [],
    };
}

function ask(field: keyof ProductBrief, prompt: string): ProductDetailAssistantTurn {
    return {
        message: prompt,
        question: { field, prompt },
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
