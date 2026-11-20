import { normalizeStoryboard, createFallbackStoryboard } from "@/lib/product-detail/storyboard";
import { requestImageQuestion } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductBrief, Storyboard, UserDesignSkill } from "@/types/product-detail";

export async function requestProductDetailStoryboard(
    config: AiConfig,
    brief: ProductBrief,
    skill: UserDesignSkill,
    signal?: AbortSignal,
): Promise<Storyboard> {
    const prompt = [
        "请为商品详情页生成结构化分镜，只输出 JSON。",
        "页面数量 6 到 10 页，第一页必须是 hero。",
        "每页字段：id, order, role, title, message, copy, visualPrompt, negativePrompt, referenceAssetIds, factRefs, layoutTemplateId, status。",
        "role 仅允许 hero, pain-point, core-benefit, feature-detail, scenario, how-to-use, specification, trust, closing。",
        "copy 是 {id, kind: eyebrow|title|body|spec|cta, text} 数组。",
        "不得虚构商品事实。没有证据时不要生成 trust 页面。",
        `商品 Brief：${JSON.stringify(brief)}`,
        `用户设计 Skill：${JSON.stringify(skill)}`,
    ].join("\n");
    try {
        const raw = await requestImageQuestion(
            { ...config, model: config.textModel || config.model },
            [{ role: "system", content: "你是电商详情页分镜策划器，只输出合法 JSON。" }, { role: "user", content: prompt }],
            () => undefined,
            { signal },
        );
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("分镜输出不是 JSON");
        return normalizeStoryboard(JSON.parse(raw.slice(start, end + 1)), brief, skill);
    } catch (error) {
        if (signal?.aborted) throw error;
        return createFallbackStoryboard(brief, skill);
    }
}
