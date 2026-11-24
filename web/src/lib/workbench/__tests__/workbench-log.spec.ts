import { describe, expect, it } from "vitest";

import { buildImageLog, normalizeImageLogConfig, serializeImageLog } from "@/lib/workbench/image-log";
import { buildVideoLog, normalizeVideoLogConfig, serializeVideoLog } from "@/lib/workbench/video-log";
import type { ImageGenerationLog, ImageGenerationLogConfig, VideoGenerationLog, VideoGenerationLogConfig } from "@/types/workbench";

const imageConfig: ImageGenerationLogConfig = {
    model: "image-model",
    imageModel: "image-model",
    quality: "high",
    size: "1024x1536",
    count: "2",
};

const videoConfig: VideoGenerationLogConfig = {
    model: "video-model",
    videoModel: "video-model",
    size: "1280x720",
    vquality: "720p",
    videoSeconds: "8",
    videoDurationAuto: false,
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoMode: "frames",
};

describe("workbench log helpers", () => {
    it("builds and serializes image logs without persisting durable blob payloads", () => {
        const log = buildImageLog({
            prompt: "一杯冰咖啡",
            model: "image-model",
            config: imageConfig,
            references: [{ id: "ref-1", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,AA", storageKey: "image:ref" }],
            durationMs: 1200,
            successCount: 2,
            failCount: 0,
            status: "success",
            images: [{ id: "img-1", dataUrl: "data:image/png;base64,AA", storageKey: "image:1", durationMs: 900, width: 1024, height: 1536, bytes: 2 }],
        });

        expect(log.imageCount).toBe(2);
        expect(log.size).toBe("1024x1536");
        const serialized = serializeImageLog(log);
        expect(serialized.images[0].dataUrl).toBe("");
        expect(serialized.references[0].dataUrl).toBe("");
    });

    it("normalizes legacy image log config fields", () => {
        const log = {
            model: "legacy-image",
            size: "512x512",
            quality: "medium",
            imageCount: 3,
        } as Partial<ImageGenerationLog>;

        expect(normalizeImageLogConfig(log)).toEqual({
            model: "legacy-image",
            imageModel: "legacy-image",
            quality: "medium",
            size: "512x512",
            count: "3",
        });
    });

    it("builds and serializes video logs", () => {
        const log = buildVideoLog({
            prompt: "海边慢镜头",
            model: "video-model",
            config: videoConfig,
            references: [],
            referenceVideos: [],
            referenceAudios: [],
            durationMs: 3000,
            status: "success",
            video: { id: "v1", url: "blob:video", storageKey: "video:1", durationMs: 1000, width: 1280, height: 720, bytes: 4, mimeType: "video/mp4" },
        });

        expect(log.resolution).toBe("720");
        expect(log.seconds).toBe("8");
        expect(serializeVideoLog(log).video?.url).toBe("");
    });

    it("normalizes legacy video log config fields", () => {
        const log = {
            model: "legacy-video",
            size: "1080x1920",
            resolution: "1080",
            seconds: "12",
            status: "failed",
        } as Partial<VideoGenerationLog>;

        expect(normalizeVideoLogConfig(log)).toEqual({
            model: "legacy-video",
            videoModel: "legacy-video",
            size: "1080x1920",
            vquality: "1080",
            videoSeconds: "12",
            videoGenerateAudio: "true",
            videoWatermark: "false",
            videoMode: "frames",
        });
    });
});