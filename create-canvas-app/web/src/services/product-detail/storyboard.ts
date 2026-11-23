import { extractFirstJsonObject } from "@/lib/product-detail/json";
import { normalizeStoryboard, createFallbackStoryboard } from "@/lib/product-detail/storyboard";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { MAX_STORYBOARD_REFERENCE_IMAGES, prioritizeReferenceAssets } from "@/lib/product-detail/reference-selection";
import { prepareReferenceImagesForRequest } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductBrief, ProductDetailAsset, Storyboard, UserDesignSkill } from "@/types/product-detail";

export async function requestProductDetailStoryboard(
    config: AiConfig,
    brief: ProductBrief,
    skill: UserDesignSkill,
    attachments: ProductDetailAsset[] = [],
    signal?: AbortSignal,
): Promise<Storyboard> {
    const selectedAttachments = prioritizeReferenceAssets(attachments, MAX_STORYBOARD_REFERENCE_IMAGES);
    const references = selectedAttachments.length
        ? await prepareReferenceImagesForRequest(selectedAttachments.map((asset) => ({ id: asset.id, name: asset.name, type: asset.mimeType, dataUrl: asset.url || "", storageKey: asset.storageKey, width: asset.width, height: asset.height, bytes: asset.bytes })))
        : [];
    const prompt = [
        "请为商品详情页生成结构化分镜，只输出 JSON。",
        "页面数量 6 到 10 页，第一页必须是 hero。",
        "每页字段：id, order, role, title, message, copy, visualPrompt, negativePrompt, referenceAssetIds, factRefs, layoutTemplateId, status。",
        "role 仅允许 hero, pain-point, core-benefit, feature-detail, scenario, how-to-use, specification, trust, closing。",
        "copy 是 {id, kind: eyebrow|title|body|spec|cta, text} 数组。specification、feature-detail、trust 页面必须提供 spec 条目；closing 页面必须提供 cta。",
        "详情页按消费者决策顺序组织：首屏识别商品与核心利益，随后用痛点、场景、细节和可验证证据消除疑虑，规格集中呈现，收尾给出明确行动理由。每一屏只回答一个购买问题。",
        "eyebrow 必须是消费者可读的短营销短语；严禁输出“首屏主视觉、痛点共鸣、核心利益、细节展示、规格信息、信任信息、收尾转化”等内部模块名。",
        "最终消费者文案中严禁出现页码、图片编号、编码、P01、“第 1 张”“1 号图片”等制作过程标记。",
        "视觉底图必须完整保留商品主体和关键信息，不使用遮挡商品的渐变蒙层；文案由渲染器放在图片之外的独立文字区。",
        "规格页的 spec 只能使用用户已确认的容量、尺寸、材质、型号、续航、包装等内容，不得编造参数；没有足够参数时明确写“参数待用户确认”，不要虚构。",
        "每页 visualPrompt 必须独立且具体，至少包含：本页场景、画面构图、镜头距离、光线、产品摆放方式、背景环境、文案安全区。",
        "visualPrompt 只描述单张可拍摄画面，不要复刻参考图的排版、宫格或卡片结构，不要复述 title、message 或 copy，不得把任何页面文案写入图片提示词。",
        "禁止复用同一段提示词。hero 使用主视觉构图；pain-point 使用痛点叙事；core-benefit 使用利益可视化；feature-detail 使用材质微距；scenario 使用真实场景；how-to-use 使用连续步骤构图；specification 使用规整平铺；trust 使用细节证据；closing 使用氛围收尾。",
        "所有 visualPrompt 都必须保持商品外观与用户商品图一致；商品自身已有的 Logo 保持原样，除此之外不得新增文字、数字、徽章、水印或 UI。",
        "不得虚构商品事实。没有证据时不要生成 trust 页面。",
        "如果本次提供了商品图或参考图，先分析其中的商品外观、主色、材质、花型、空间氛围和版式节奏；配色、字体、视觉调性和场景必须从参考图与 Brief 中提取，不得套用预设色板或默认风格。",
        "用户设计 Skill 只提供结构、类目知识和约束，不代表已经选定品牌色、字体或视觉风格。",
        `商品 Brief：${JSON.stringify(brief)}`,
        `用户设计 Skill：${JSON.stringify(skill)}`,
    ].join("\n");
    try {
        const userContent: AiTextMessage["content"] = references.length
            ? [
                { type: "text", text: prompt },
                ...references.filter((item) => item.dataUrl).slice(0, 8).map((item) => ({ type: "image_url" as const, image_url: { url: item.dataUrl } })),
            ]
            : prompt;
        const raw = await requestImageQuestion(
            { ...config, model: config.textModel || config.model },
            [
                { role: "system", content: "你是电商详情页分镜策划器，只输出合法 JSON。不要预设品牌色或视觉风格，必须优先依据用户的商品图和参考图。" },
                { role: "user", content: userContent },
            ],
            () => undefined,
            { signal },
        );
        const json = extractFirstJsonObject(raw);
        if (!json) throw new Error("分镜输出不是 JSON");
        return normalizeStoryboard(JSON.parse(json), brief, skill);
    } catch (error) {
        if (signal?.aborted) throw error;
        const fallback = createFallbackStoryboard(brief, skill);
        return { ...fallback, warning: `文本模型调用失败，已使用基础分镜模板：${error instanceof Error ? error.message : String(error)}` };
    }
}