import { describe, expect, it, vi } from "vitest";

import { buildGenerationConfig, prepareCanvasReferenceImagesForRequest } from "../canvas-generation-helpers";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { CanvasNodeData } from "@/types/canvas";

vi.mock("@/services/image-storage", () => ({
    claimLegacyStoredImage: vi.fn(),
    ensureImagePreview: vi.fn(),
    getImageBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
    prepareImageRequestDataUrls: vi.fn(async (images: ReferenceImage[]) => images.map(() => ({
        dataUrl: "data:image/webp;base64,aW1hZ2U=",
        mimeType: "image/webp",
        bytes: 5,
        sourceBytes: 5,
        width: 1024,
        height: 1024,
        reencoded: true,
        policy: 0,
    }))),
    resolveImageUrl: vi.fn(),
    uploadImage: vi.fn(),
}));

vi.mock("@/services/file-storage", () => ({
    resolveMediaUrl: vi.fn(),
}));

describe("buildGenerationConfig", () => {
    it("sanitizes canvas video parameters from the active model capability", () => {
        const capability = {
            protocol: "seedance_video",
            min_duration: 5,
            max_duration: 10,
            default_duration: 5,
            duration_options: [5, 10],
            resolutions: ["720p"],
            aspect_ratios: ["9:16"],
            slots: { first_frame: 1, last_frame: 0, reference_image: 2, reference_video: 0, reference_audio: 0 },
            supports_generate_audio: true,
        };
        const channel = createModelChannel({
            id: "channel",
            name: "channel",
            baseUrl: "https://example.com/v1",
            apiKey: "key",
            models: [{ name: "new-video-model", capability: "video", videoCapabilities: capability }],
        });
        const config = {
            ...defaultConfig,
            channels: [channel],
            videoModel: encodeChannelModel(channel.id, "new-video-model"),
            vquality: "1080",
            size: "1920x1080",
            videoSeconds: "15",
        };

        const built = buildGenerationConfig(config, undefined, "video");

        expect(built.vquality).toBe("720");
        expect(built.videoSeconds).toBe("10");
        expect(built.size).toBe("720x1280");
    });

    it("restores persisted video parameters from canvas node metadata", () => {
        const capability = {
            protocol: "momo_video",
            min_duration: 4,
            max_duration: 15,
            default_duration: 5,
            resolutions: ["720p"],
            aspect_ratios: ["16:9"],
            slots: { first_frame: 0, last_frame: 0, reference_image: 3, reference_video: 1, reference_audio: 1 },
            parameters: [{ key: "seed", type: "integer" as const, min: 0, max: 100 }],
        };
        const channel = createModelChannel({
            id: "channel",
            name: "channel",
            baseUrl: "https://example.com/v1",
            apiKey: "key",
            models: [{ name: "parameter-video", capability: "video", videoCapabilities: capability }],
        });
        const config = { ...defaultConfig, channels: [channel], videoModel: encodeChannelModel(channel.id, "parameter-video") };
        const node = { id: "node", metadata: { videoParameters: { seed: 77 } } } as unknown as CanvasNodeData;

        expect(buildGenerationConfig(config, node, "video").videoParameters).toEqual({ seed: 77 });
    });
});
describe("prepareCanvasReferenceImagesForRequest", () => {
    it("returns locally compressed data URLs without uploading to R2 first", async () => {
        const reference = (index: number): ReferenceImage => ({
            id: `node-${index}`,
            name: "shared.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,aW1hZ2U=",
            storageKey: "image:shared",
        });

        const results = await prepareCanvasReferenceImagesForRequest("project-dedupe", [reference(0)]);

        expect(results[0]).toMatchObject({
            dataUrl: "data:image/webp;base64,aW1hZ2U=",
            type: "image/webp",
            storageKey: undefined,
            url: undefined,
        });
    });
});
