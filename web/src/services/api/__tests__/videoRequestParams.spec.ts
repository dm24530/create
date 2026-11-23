import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.assign(globalThis, {
        localStorage: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        },
    });
});

import { buildOpenAIVideoTaskPath, buildVideoProviderRequest, mapPendingVideoPhase, type VideoProviderRequestInput } from "../video";

const base: VideoProviderRequestInput = {
    model: "model",
    prompt: "a cat running",
    durationSeconds: 8,
    resolution: "720p",
    aspectRatio: "16:9",
    generateAudio: true,
    imageUrls: ["https://cdn.example.com/frame.png"],
    videoUrls: [],
    audioUrls: [],
    imageMode: "frames",
};

describe("vendor video request builders", () => {
    it("uses Muse JSON fields", () => {
        const request = buildVideoProviderRequest("muse_video", {
            ...base,
            model: "muse-video",
            aspectRatio: "9:16",
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            model: "muse-video",
            prompt: "a cat running",
            duration: 8,
            resolution: "720p",
            aspect_ratio: "9:16",
            first_frame_image_url: "https://cdn.example.com/frame.png",
        });
    });

    it("uses Grok duration, resolution and aspect_ratio fields", () => {
        const request = buildVideoProviderRequest("grok", {
            ...base,
            model: "grok-imagine-video",
            resolution: "480p",
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            duration: 8,
            resolution: "480p",
            aspect_ratio: "16:9",
            first_frame_image_url: "https://cdn.example.com/frame.png",
        });
        expect(request.body).not.toHaveProperty("seconds");
    });

    it("uses the documented Grok reference-video fields", () => {
        const request = buildVideoProviderRequest("grok", {
            ...base,
            videoUrls: ["https://cdn.example.com/source.mp4"],
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            mode: "reference-video",
            reference_video_urls: ["https://cdn.example.com/source.mp4"],
        });
        expect(request.body).not.toHaveProperty("video");
    });

    it("uses Seedance reference-video mode without mixing reference audio", () => {
        const request = buildVideoProviderRequest("seedance_video", {
            ...base,
            model: "seedance-2.5",
            resolution: "1080p",
            imageMode: "reference",
            videoUrls: ["https://cdn.example.com/ref.mp4"],
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            duration: 8,
            resolution: "1080p",
            aspect_ratio: "16:9",
            generate_audio: true,
            mode: "reference-video",
            reference_video_urls: ["https://cdn.example.com/ref.mp4"],
        });
        expect(request.body).not.toHaveProperty("reference_audio_urls");
    });

    it("uses Seedance reference-images mode for reference audio", () => {
        const request = buildVideoProviderRequest("seedance_video", {
            ...base,
            model: "seedance-2.5",
            imageMode: "reference",
            audioUrls: ["https://cdn.example.com/ref.mp3"],
        });

        expect(request.body).toMatchObject({
            mode: "reference-images",
            reference_image_urls: ["https://cdn.example.com/frame.png"],
            reference_audio_urls: ["https://cdn.example.com/ref.mp3"],
        });
    });

    it("uses first and last frame URL fields for Seedance first-last-frame mode", () => {
        const request = buildVideoProviderRequest("seedance_video", {
            ...base,
            model: "seedance-2.0",
            imageMode: "frames",
            imageUrls: [
                "https://cdn.example.com/first.png",
                "https://cdn.example.com/last.png",
            ],
        });

        expect(request.body).toMatchObject({
            mode: "first-last-frame",
            first_frame_image_url: "https://cdn.example.com/first.png",
            last_frame_image_url: "https://cdn.example.com/last.png",
        });
        expect(request.body).not.toHaveProperty("images");
    });

    it("rejects incompatible Seedance reference video and reference audio together", () => {
        expect(() => buildVideoProviderRequest("seedance_video", {
            ...base,
            model: "seedance-2.5",
            videoUrls: ["https://cdn.example.com/ref.mp4"],
            audioUrls: ["https://cdn.example.com/ref.mp3"],
        })).toThrow("参考视频和参考音频");
    });

    it("uses the Ark content task protocol for direct OpenAI Ark channels", () => {
        const request = buildVideoProviderRequest("seedance", {
            ...base,
            model: "seedance 2.5-GT",
            imageMode: "reference",
            videoUrls: ["https://cdn.example.com/ref.mp4"],
            audioUrls: ["https://cdn.example.com/ref.mp3"],
        });

        expect(request.path).toBe("/contents/generations/tasks");
        expect(request.body).toMatchObject({
            model: "seedance 2.5-GT",
            duration: 8,
            resolution: "720p",
            ratio: "16:9",
            generate_audio: true,
            content: [
                { type: "text", text: "a cat running" },
                { type: "image_url", image_url: { url: "https://cdn.example.com/frame.png" }, role: "reference_image" },
                { type: "video_url", video_url: { url: "https://cdn.example.com/ref.mp4" }, role: "reference_video" },
                { type: "audio_url", audio_url: { url: "https://cdn.example.com/ref.mp3" }, role: "reference_audio" },
            ],
        });
    });

    it("marks extra Ark frame-mode images as reference images", () => {
        const request = buildVideoProviderRequest("seedance", {
            ...base,
            model: "seedance 2.5-GT",
            imageMode: "frames",
            imageUrls: [
                "https://cdn.example.com/first.png",
                "https://cdn.example.com/last.png",
                "https://cdn.example.com/style.png",
            ],
        });

        expect(request.body.content).toContainEqual({
            type: "image_url",
            image_url: { url: "https://cdn.example.com/style.png" },
            role: "reference_image",
        });
    });

    it("forwards the supported four second Muse duration without replacing it with the default", () => {
        const request = buildVideoProviderRequest("muse_video", {
            ...base,
            model: "muse-video",
            durationSeconds: 4,
        });

        expect(request.body.duration).toBe(4);
    });

    it("omits vendor duration fields in automatic duration mode", () => {
        const muse = buildVideoProviderRequest("muse_video", {
            ...base,
            model: "muse-video",
            durationAuto: true,
        });
        const grok = buildVideoProviderRequest("grok", {
            ...base,
            model: "grok-imagine-video",
            durationAuto: true,
        });

        expect(muse.body).not.toHaveProperty("duration");
        expect(grok.body).not.toHaveProperty("duration");
    });

    it("maps the workbench 1280x720 and 5 second selection to vendor-native fields", () => {
        const input = { ...base, durationSeconds: 5, resolution: "720p", aspectRatio: "16:9" };

        const muse = buildVideoProviderRequest("muse_video", input);
        expect(muse.body).toMatchObject({ duration: 5, resolution: "720p", aspect_ratio: "16:9" });

        const grok = buildVideoProviderRequest("grok", input);
        expect(grok.body).toMatchObject({ duration: 5, resolution: "720p", aspect_ratio: "16:9" });

        const seedance = buildVideoProviderRequest("seedance_video", input);
        expect(seedance.body).toMatchObject({ duration: 5, resolution: "720p", aspect_ratio: "16:9" });
    });

    it("resolves server-relative reference assets to absolute URLs for video providers", () => {
        vi.stubEnv("VITE_CREATE_API_BASE_URL", "https://create.example.com/api/v1");
        const imageUrl = "/api/v1/public/video-reference-assets/reference-token";
        const input = {
            ...base,
            model: "muse-video",
            imageUrls: [imageUrl],
        };

        const muse = buildVideoProviderRequest("muse_video", input);
        expect(muse.body.first_frame_image_url).toBe("https://create.example.com/api/v1/public/video-reference-assets/reference-token");

        const seedance = buildVideoProviderRequest("seedance_video", {
            ...input,
            model: "seedance-2.0",
            imageMode: "reference",
        });
        expect(seedance.body.reference_image_urls).toEqual([
            "https://create.example.com/api/v1/public/video-reference-assets/reference-token",
        ]);
        vi.unstubAllEnvs();
    });
    it("uses the documented MiniMax video generation fields", () => {
        const request = buildVideoProviderRequest("video_tasks", {
            ...base,
            model: "minimax H3-self",
            resolution: "768p",
            imageMode: "reference",
            audioUrls: ["https://cdn.example.com/ref.mp3"],
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            duration: 8,
            resolution: "768p",
            aspect_ratio: "16:9",
            reference_image_urls: ["https://cdn.example.com/frame.png"],
            reference_audio_urls: ["https://cdn.example.com/ref.mp3"],
        });
    });

    it("uses MiniMax reference-image fields when audio and frame images are present", () => {
        const request = buildVideoProviderRequest("video_tasks", {
            ...base,
            model: "minimax H3-self",
            imageMode: "frames",
            audioUrls: ["https://cdn.example.com/ref.mp3"],
        });

        expect(request.body).toMatchObject({
            reference_image_urls: ["https://cdn.example.com/frame.png"],
            reference_audio_urls: ["https://cdn.example.com/ref.mp3"],
        });
        expect(request.body).not.toHaveProperty("first_frame_image_url");
    });
    it("maps upstream video statuses to queued and generating phases", () => {
        expect(mapPendingVideoPhase("queued")).toBe("queued");
        expect(mapPendingVideoPhase("submitted")).toBe("queued");
        expect(mapPendingVideoPhase("processing")).toBe("generating");
        expect(mapPendingVideoPhase("in_progress")).toBe("generating");
        expect(mapPendingVideoPhase("unknown")).toBe("generating");
    });

    it("adds the model hint to unified video polling and download paths", () => {
        expect(buildOpenAIVideoTaskPath("task/1", "seedance 2.5-GT", "status"))
            .toBe("/videos/task%2F1?model=seedance%202.5-GT");
        expect(buildOpenAIVideoTaskPath("task/1", "seedance 2.5-GT", "content"))
            .toBe("/videos/task%2F1/content?model=seedance%202.5-GT");
    });

});
