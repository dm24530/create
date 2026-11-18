// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { buildNodeGenerationContext } from "../canvas-node-generation";

describe("buildNodeGenerationContext", () => {
    it("uses all connected references when a config composer has no explicit reference tokens", () => {
        const nodes: CanvasNodeData[] = [
            {
                id: "image-1",
                type: CanvasNodeType.Image,
                title: "desk",
                position: { x: 0, y: 0 },
                width: 300,
                height: 300,
                metadata: { content: "data:image/png;base64,AA==", mimeType: "image/png" },
            },
            {
                id: "image-2",
                type: CanvasNodeType.Image,
                title: "room",
                position: { x: 0, y: 360 },
                width: 300,
                height: 300,
                metadata: { content: "data:image/png;base64,BB==", mimeType: "image/png" },
            },
            {
                id: "config",
                type: CanvasNodeType.Config,
                title: "config",
                position: { x: 420, y: 0 },
                width: 320,
                height: 240,
                metadata: { composerContent: "将图1的烟放到图2桌子上" },
            },
        ];
        const connections: CanvasConnection[] = [
            { id: "c1", fromNodeId: "image-1", toNodeId: "config" },
            { id: "c2", fromNodeId: "image-2", toNodeId: "config" },
        ];

        const context = buildNodeGenerationContext("config", nodes, connections, "将图1的烟放到图2桌子上");

        expect(context.referenceImages.map((image) => image.id)).toEqual(["image-1", "image-2"]);
        expect(context.imageCount).toBe(2);
        expect(context.prompt).toBe("将图1的烟放到图2桌子上");
    });
});
