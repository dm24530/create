export type ImageQuality = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type GptImageQualityCeiling = "high" | "xhigh" | "max";

const BASE_QUALITIES: readonly ImageQuality[] = ["auto", "low", "medium", "high"];
const GPT_IMAGE_QUALITIES: readonly ImageQuality[] = [...BASE_QUALITIES, "xhigh", "max"];
const QUALITY_RANK: Record<ImageQuality, number> = { auto: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };

export function imageModelBaseName(model: string) {
    const value = model.trim().toLowerCase();
    const separator = value.lastIndexOf("::");
    return separator >= 0 ? value.slice(separator + 2) : value;
}

export function isGptImageModel(model: string) {
    return imageModelBaseName(model).startsWith("gpt-image-");
}

export function isGrokImageModel(model: string) {
    const value = imageModelBaseName(model);
    return value.includes("grok-imagine") && !value.includes("video");
}

export function isGeminiImageModel(model: string) {
    const value = imageModelBaseName(model);
    return value.includes("banana") || (value.includes("gemini") && value.includes("image"));
}

export function imageQualityOptionsForModel(model: string): readonly ImageQuality[] {
    if (isGrokImageModel(model)) return [];
    if (isGeminiImageModel(model)) {
        return imageModelBaseName(model).includes("gemini-3.1-flash-lite-image")
            ? ["auto", "low"]
            : GPT_IMAGE_QUALITIES;
    }
    return isGptImageModel(model) ? GPT_IMAGE_QUALITIES : BASE_QUALITIES;
}

export function normalizeImageQuality(value: string | undefined): ImageQuality {
    const normalized = value?.trim().toLowerCase() as ImageQuality | undefined;
    return normalized && normalized in QUALITY_RANK ? normalized : "auto";
}

export function effectiveImageQualityForRequest(
    model: string,
    selected: string | undefined,
    gptCeiling: GptImageQualityCeiling = "high",
): ImageQuality {
    const quality = normalizeImageQuality(selected);
    const allowed = imageQualityOptionsForModel(model);
    if (!allowed.length) return "auto";
    if (allowed.includes(quality)) {
        if (!isGptImageModel(model)) return quality;
        return QUALITY_RANK[quality] > QUALITY_RANK[gptCeiling] ? gptCeiling : quality;
    }
    let fallback: ImageQuality = allowed[0] || "auto";
    for (const candidate of allowed) {
        if (QUALITY_RANK[candidate] <= QUALITY_RANK[quality]) fallback = candidate;
    }
    return fallback;
}

export function imageQualityFallbackNote(model: string, selected: string | undefined, gptCeiling: GptImageQualityCeiling) {
    if (!isGptImageModel(model)) return "";
    const quality = normalizeImageQuality(selected);
    const effective = effectiveImageQualityForRequest(model, quality, gptCeiling);
    return quality === effective ? "" : `当前渠道最高支持 ${gptCeiling}，${quality} 将按 ${effective} 调用。`;
}