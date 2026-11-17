import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData, type CanvasNodeStatus } from "@/types/canvas";
import { createCanvasGenerationClock, recordCanvasGenerationDurations } from "../canvas-generation-duration";

function imageNode(status: CanvasNodeStatus, metadata: Partial<CanvasNodeData["metadata"]> = {}): CanvasNodeData {
    return {
        id: "image-1",
        type: CanvasNodeType.Image,
        title: "Generated image",
        position: { x: 0, y: 0 },
        width: 512,
        height: 512,
        metadata: {
            status,
            generationStartedAt: 1_000,
            ...metadata,
        },
    };
}

describe("recordCanvasGenerationDurations", () => {
    it("records elapsed time when an active generation succeeds", () => {
        const clock = createCanvasGenerationClock();
        recordCanvasGenerationDurations([imageNode("loading")], clock, 1_500);
        const nodes = [imageNode("success", { durationMs: 8_000 })];

        const [node] = recordCanvasGenerationDurations(nodes, clock, 4_250);

        expect(node.metadata?.generationDurationMs).toBe(3_250);
        expect(node.metadata?.durationMs).toBe(8_000);
    });

    it("does not invent a duration for a node restored as already successful", () => {
        const clock = createCanvasGenerationClock();
        const nodes = [imageNode("success")];

        const [node] = recordCanvasGenerationDurations(nodes, clock, 50_000);

        expect(node.metadata?.generationDurationMs).toBeUndefined();
    });

    it("clears the previous duration when a new generation starts", () => {
        const clock = createCanvasGenerationClock();
        const nodes = [imageNode("loading", { generationDurationMs: 2_000 })];

        const [node] = recordCanvasGenerationDurations(nodes, clock, 5_000);

        expect(node.metadata?.generationDurationMs).toBeUndefined();
    });

    it("waits for the persisted image instead of stopping at a preview", () => {
        const clock = createCanvasGenerationClock();
        recordCanvasGenerationDurations([imageNode("loading")], clock, 1_000);

        const [preview] = recordCanvasGenerationDurations([imageNode("success", { previewOnly: true })], clock, 2_000);
        expect(preview.metadata?.generationDurationMs).toBeUndefined();

        const [completed] = recordCanvasGenerationDurations([imageNode("success", { previewOnly: false })], clock, 4_250);
        expect(completed.metadata?.generationDurationMs).toBe(3_250);
    });
});
