import { describe, expect, it } from "vitest";

import { createModelChannel, type ModelChannel } from "@/stores/use-config-store";

import { buildCapabilityModelGroups } from "../model-boundary";

function channel(id: string, models: Array<{ name: string; capability: "image" | "video" | "text" }>): ModelChannel {
    return createModelChannel({
        id,
        name: id,
        baseUrl: "https://create.superai.sbs/v1",
        apiKey: `key-${id}`,
        apiFormat: "openai",
        models,
    });
}

describe("buildCapabilityModelGroups", () => {
    it("keeps only image models in the image workbench", () => {
        const groups = buildCapabilityModelGroups([
            channel("mixed", [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
            ]),
        ], "image");

        expect(groups).toHaveLength(1);
        expect(groups[0]?.models.map((model) => model.label)).toEqual(["gpt-image-2"]);
    });

    it("does not expose a video-only channel in the image workbench", () => {
        const groups = buildCapabilityModelGroups([
            channel("video-only", [{ name: "grok-imagine-video", capability: "video" }]),
        ], "image");

        expect(groups).toEqual([]);
    });

    it("does not expose an image-only channel in the video workbench", () => {
        const groups = buildCapabilityModelGroups([
            channel("image-only", [{ name: "gpt-image-2", capability: "image" }]),
        ], "video");

        expect(groups).toEqual([]);
    });
});