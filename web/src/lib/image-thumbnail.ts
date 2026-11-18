export const CANVAS_IMAGE_PREVIEW_MAX_EDGE = 768;
export const CANVAS_IMAGE_REQUEST_BUDGET_BYTES = 4 * 1024 * 1024;
export const CANVAS_IMAGE_REQUEST_POLICY_VERSION = "v5";

export type ImageRequestPolicy = {
    maxEdge: number;
    quality: number;
    targetBytes: number;
};

export const CANVAS_IMAGE_REQUEST_POLICIES: readonly ImageRequestPolicy[] = [
    { maxEdge: 1600, quality: 0.78, targetBytes: 480 * 1024 },
    { maxEdge: 1400, quality: 0.74, targetBytes: 360 * 1024 },
    { maxEdge: 1200, quality: 0.72, targetBytes: 280 * 1024 },
    { maxEdge: 1024, quality: 0.7, targetBytes: 210 * 1024 },
    { maxEdge: 800, quality: 0.68, targetBytes: 150 * 1024 },
];

type ImageSourceChoice = {
    previewUrl?: string;
    originalUrl: string;
    naturalWidth?: number;
    naturalHeight?: number;
    renderedWidth: number;
    renderedHeight: number;
    scale: number;
    devicePixelRatio?: number;
    previewMaxEdge?: number;
};

// Small previews keep panning cheap, but they look soft once the node is magnified.
// Use the original only when the on-screen size actually needs more pixels than the preview holds.
export function pickImageSource({ previewUrl, originalUrl, naturalWidth, naturalHeight, renderedWidth, renderedHeight, scale, devicePixelRatio = globalThis.devicePixelRatio || 1, previewMaxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE }: ImageSourceChoice) {
    if (!previewUrl) return originalUrl;
    const naturalLongEdge = Math.max(naturalWidth || 0, naturalHeight || 0);
    const previewLongEdge = naturalLongEdge > 0 ? Math.min(previewMaxEdge, naturalLongEdge) : previewMaxEdge;
    const requiredLongEdge = Math.max(renderedWidth, renderedHeight) * scale * devicePixelRatio;
    return requiredLongEdge > previewLongEdge ? originalUrl : previewUrl;
}

export function getThumbnailDimensions(width: number, height: number, maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function createImageThumbnail(blob: Blob, maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE) {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = getThumbnailDimensions(bitmap.width, bitmap.height, maxEdge);
    if (width === bitmap.width && height === bitmap.height) {
        bitmap.close();
        return undefined;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        return undefined;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return new Promise<Blob | undefined>((resolve) => canvas.toBlob((result) => resolve(result || undefined), "image/webp", 0.86));
}

// Reference images are uploaded inside JSON for Gemini requests. Original
// screenshots can be tens of megabytes each, so resize/re-encode them before
// creating the data URL while keeping enough detail for editing.
export async function createImageRequestBlob(blob: Blob, policy: ImageRequestPolicy) {
    const bitmap = await createImageBitmap(blob);
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const firstDimensions = getThumbnailDimensions(bitmap.width, bitmap.height, policy.maxEdge);
    if (
        firstDimensions.width === bitmap.width &&
        firstDimensions.height === bitmap.height &&
        blob.size <= policy.targetBytes
    ) {
        bitmap.close();
        return {
            blob,
            width: firstDimensions.width,
            height: firstDimensions.height,
            reencoded: false,
        };
    }

    const attempts = [
        { scale: 1, quality: policy.quality },
        { scale: 1, quality: Math.max(0.62, policy.quality - 0.08) },
        { scale: 0.88, quality: Math.max(0.64, policy.quality - 0.04) },
        { scale: 0.76, quality: Math.max(0.62, policy.quality - 0.08) },
        { scale: 0.66, quality: Math.max(0.6, policy.quality - 0.1) },
        { scale: 0.58, quality: Math.max(0.58, policy.quality - 0.12) },
        { scale: 0.5, quality: Math.max(0.56, policy.quality - 0.16) },
    ];

    let best: { blob: Blob; width: number; height: number } | null = null;
    try {
        for (const attempt of attempts) {
            const maxEdge = Math.max(1, Math.round(policy.maxEdge * attempt.scale));
            const { width, height } = getThumbnailDimensions(bitmap.width, bitmap.height, maxEdge);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) break;
            context.drawImage(bitmap, 0, 0, width, height);
            const encoded = await new Promise<Blob | undefined>((resolve) => {
                canvas.toBlob((result) => resolve(result || undefined), "image/webp", attempt.quality);
            });
            if (!encoded) continue;
            if (!best || encoded.size < best.blob.size) best = { blob: encoded, width, height };
            if (encoded.size <= policy.targetBytes) break;
        }
    } finally {
        bitmap.close();
    }

    if (!best || best.blob.size >= blob.size) {
        return {
            blob,
            width: originalWidth,
            height: originalHeight,
            reencoded: false,
        };
    }
    return {
        blob: best.blob,
        width: best.width,
        height: best.height,
        reencoded: true,
    };
}
