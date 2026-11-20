import { buildProductDetailConversationMessages, fallbackProductDetailTurn, parseProductDetailAssistantTurn } from "@/lib/product-detail/conversation";
import { requestImageQuestion } from "@/services/api/image";
import { prepareReferenceImagesForRequest } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductBrief, ProductDetailAsset, ProductDetailAssistantTurn, ProductDetailConversationMessage, Storyboard, UserDesignSkill } from "@/types/product-detail";

export async function requestProductDetailTurn(
    config: AiConfig,
    input: { brief: ProductBrief; messages: ProductDetailConversationMessage[]; skill?: UserDesignSkill; userMessage?: string; attachments?: ProductDetailAsset[]; storyboard?: Storyboard },
    signal?: AbortSignal,
): Promise<ProductDetailAssistantTurn> {
    const references = input.attachments?.length
        ? await prepareReferenceImagesForRequest(input.attachments.map((asset) => ({ id: asset.id, name: asset.name, type: asset.mimeType, dataUrl: asset.url || "", storageKey: asset.storageKey, width: asset.width, height: asset.height, bytes: asset.bytes }))).catch(() => [])
        : [];
    const messages = buildProductDetailConversationMessages({ ...input, attachments: references });
    try {
        const raw = await requestImageQuestion(
            { ...config, model: config.textModel || config.model },
            messages,
            () => undefined,
            { signal },
        );
        return parseProductDetailAssistantTurn(raw);
    } catch (error) {
        if (signal?.aborted) throw error;
        const fallback = fallbackProductDetailTurn(input.brief);
        return {
            ...fallback,
            message: `${fallback.message}\n\n文本模型暂时不可用：${error instanceof Error ? error.message : String(error)}`,
            risks: ["本轮未完成模型策划，可修改 Brief 或重试。"],
        };
    }
}
