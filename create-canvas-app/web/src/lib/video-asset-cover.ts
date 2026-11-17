import { captureVideoFrame } from "@/lib/canvas/canvas-video-frame";
import { readFileAsDataUrl } from "@/lib/image-utils";

const COVER_FRAME_TIMES = [0, 0.08, 0.25, 0.8, 1.5];

export async function captureVideoAssetCover(source: string, maxWidth = 640) {
    let lastError: unknown;
    for (const [index, time] of COVER_FRAME_TIMES.entries()) {
        try {
            const frame = await captureVideoFrame(
                source,
                index === 0 ? "first" : "current",
                time,
                maxWidth,
                "image/jpeg",
                0.82,
            );
            return readFileAsDataUrl(new File([frame], "video-cover.jpg", { type: frame.type || "image/jpeg" }));
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error("Failed to capture video cover");
}