import { captureVideoFrame } from "@/lib/canvas/canvas-video-frame";
import { readFileAsDataUrl } from "@/lib/image-utils";

export async function captureVideoAssetCover(source: string, maxWidth = 640) {
    const frame = await captureVideoFrame(source, "first", 0, maxWidth, "image/jpeg", 0.82);
    return readFileAsDataUrl(new File([frame], "video-cover.jpg", { type: frame.type || "image/jpeg" }));
}
