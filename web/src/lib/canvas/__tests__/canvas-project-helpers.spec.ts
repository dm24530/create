import { describe, expect, it } from "vitest";

import { applyGeneratedVideo, canvasNodeImageIsPreviewOnly } from "@/lib/canvas/canvas-project-helpers";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node: CanvasNodeData = {
    id: "node-1",
    type: CanvasNodeType.Video,
    x: 100,
    y: 80,
    width: 300,
    height: 200,
    position: { x: 100, y: 80 },
    metadata: { prompt: "旧提示词" },
};

describe("canvas project helpers", () => {
    it("centers a generated video and preserves node metadata", () => {
        const next = applyGeneratedVideo(node, {
            url: "blob:video",
            storageKey: "video:1",
            bytes: 12,
            mimeType: "video/mp4",
            width: 1920,
            height: 1080,
        }, { prompt: "新提示词" });

        expect(next.width).toBeLessThanOrEqual(420);
        expect(next.height).toBeLessThanOrEqual(420);
        expect(next.position.x + next.width / 2).toBeCloseTo(node.position.x + node.width / 2);
        expect(next.metadata?.prompt).toBe("新提示词");
        expect(next.metadata?.storageKey).toBe("video:1");
    });

    it("detects preview-only image nodes without rejecting normal images", () => {
        const imageNode: CanvasNodeData = {
            ...node,
            type: CanvasNodeType.Image,
            metadata: { images: [{ id: "image-1", content: "data:image/png;base64,AA", previewOnly: true }] },
        };

        expect(canvasNodeImageIsPreviewOnly(imageNode)).toBe(true);
        expect(canvasNodeImageIsPreviewOnly({ ...imageNode, metadata: { images: [{ id: "image-1", content: "data:image/png;base64,AA" }] } })).toBe(false);
    });
});