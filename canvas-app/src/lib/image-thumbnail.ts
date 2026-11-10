export const CANVAS_IMAGE_PREVIEW_MAX_EDGE = 768;
export const CANVAS_IMAGE_REQUEST_BUDGET_BYTES = 8 * 1024 * 1024;
export const CANVAS_IMAGE_REQUEST_POLICY_VERSION = "v3";

export type ImageRequestPolicy = {
    maxEdge: number;
    quality: number;
    targetBytes: number;
};

export const CANVAS_IMAGE_REQUEST_POLICIES: readonly ImageRequestPolicy[] = [
    { maxEdge: 2048, quality: 0.9, targetBytes: 1536 * 1024 },
    { maxEdge: 1536, quality: 0.84, targetBytes: 720 * 1024 },
    { maxEdge: 1280, quality: 0.82, targetBytes: 560 * 1024 },
    { maxEdge: 1024, quality: 0.8, targetBytes: 420 * 1024 },
    { maxEdge: 768, quality: 0.76, targetBytes: 280 * 1024 },
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
    const { width, height } = getThumbnailDimensions(bitmap.width, bitmap.height, policy.maxEdge);
    const needsResize = width !== bitmap.width || height !== bitmap.height;
    if (!needsResize && blob.size <= policy.targetBytes) {
        bitmap.close();
        return { blob, width, height, reencoded: false };
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        return { blob, width: originalWidth, height: originalHeight, reencoded: false };
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const encoded = await new Promise<Blob | undefined>((resolve) => canvas.toBlob((result) => resolve(result || undefined), "image/webp", policy.quality));
    if (!encoded) return { blob, width: originalWidth, height: originalHeight, reencoded: false };
    const selected = encoded.size < blob.size ? encoded : blob;
    return {
        blob: selected,
        width: selected === encoded ? width : originalWidth,
        height: selected === encoded ? height : originalHeight,
        reencoded: selected === encoded,
    };
}
