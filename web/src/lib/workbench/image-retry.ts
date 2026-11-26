import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type ImageRetrySource = {
    prompt?: string;
    model?: string;
    config?: Partial<AiConfig>;
    references?: ReferenceImage[];
};

export type ImageRetrySnapshot = {
    text: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
};

/**
 * Rebuild a retry request from the failed task snapshot. Current form values are
 * used only as compatibility fallbacks for legacy records that did not persist
 * a prompt or model configuration.
 */
export function buildImageRetrySnapshot(
    source: ImageRetrySource,
    fallbackConfig: AiConfig,
    fallbackPrompt = "",
): ImageRetrySnapshot | null {
    const text = source.prompt?.trim() || fallbackPrompt.trim();
    if (!text) return null;

    const storedConfig = source.config || {};
    const model = storedConfig.imageModel
        || storedConfig.model
        || source.model
        || fallbackConfig.imageModel
        || fallbackConfig.model;
    if (!model) return null;

    return {
        text,
        model,
        config: {
            ...fallbackConfig,
            ...storedConfig,
            model,
            imageModel: model,
            count: "1",
        },
        references: [...(source.references || [])],
    };
}