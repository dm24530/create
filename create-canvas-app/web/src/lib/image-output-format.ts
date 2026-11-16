export type ImageOutputFormat = "png" | "jpeg";

export function normalizeImageOutputFormat(value: string | undefined): ImageOutputFormat {
    const normalized = value?.trim().toLowerCase();
    return normalized === "jpg" || normalized === "jpeg" ? "jpeg" : "png";
}

export function supportsTransparentImageBackground(model: string | undefined) {
    const value = (model || "").trim().toLowerCase();
    const gemini = value.includes("banana") || (value.includes("gemini") && value.includes("image"));
    const grok = value.includes("grok-imagine") && !value.includes("video");
    return !gemini && !grok;
}

export function normalizeImageBackground(model: string | undefined, background: string | undefined, outputFormat: string | undefined) {
    const transparent = background?.trim().toLowerCase() === "transparent";
    return transparent && supportsTransparentImageBackground(model) && normalizeImageOutputFormat(outputFormat) === "png" ? "transparent" : "";
}

export function imageOutputMimeType(outputFormat: string | undefined) {
    return normalizeImageOutputFormat(outputFormat) === "jpeg" ? "image/jpeg" : "image/png";
}

export function imageOutputFileExtension(outputFormat: string | undefined) {
    return normalizeImageOutputFormat(outputFormat) === "jpeg" ? "jpg" : "png";
}
