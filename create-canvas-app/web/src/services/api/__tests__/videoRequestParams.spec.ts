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

import { buildVideoProviderRequest, type VideoProviderRequestInput } from "../video";

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

        expect(request.path).toBe("/videos");
        expect(request.body).toMatchObject({
            model: "muse-video",
            prompt: "a cat running",
            seconds: 8,
            aspect_ratio: "9:16",
            image: "https://cdn.example.com/frame.png",
        });
    });

    it("uses Grok duration, resolution and aspect_ratio fields", () => {
        const request = buildVideoProviderRequest("grok", {
            ...base,
            model: "grok-imagine-video",
            resolution: "480p",
        });

        expect(request.path).toBe("/videos/generations");
        expect(request.body).toMatchObject({
            duration: 8,
            resolution: "480p",
            aspect_ratio: "16:9",
            image: [{ url: "https://cdn.example.com/frame.png" }],
        });
        expect(request.body).not.toHaveProperty("seconds");
    });

    it("routes Grok reference videos to the edit endpoint", () => {
        const request = buildVideoProviderRequest("grok", {
            ...base,
            videoUrls: ["https://cdn.example.com/source.mp4"],
        });

        expect(request.path).toBe("/videos/edits");
        expect(request.body.video).toEqual({ url: "https://cdn.example.com/source.mp4" });
    });

    it("uses Seedance video generation fields and reference URLs", () => {
        const request = buildVideoProviderRequest("seedance_video", {
            ...base,
            model: "seedance-2.5",
            resolution: "1080p",
            imageMode: "reference",
            videoUrls: ["https://cdn.example.com/ref.mp4"],
            audioUrls: ["https://cdn.example.com/ref.mp3"],
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            duration: 8,
            resolution: "1080p",
            aspect_ratio: "16:9",
            generate_audio: true,
            mode: "reference-video",
            reference_video_urls: ["https://cdn.example.com/ref.mp4"],
            reference_audio_urls: ["https://cdn.example.com/ref.mp3"],
        });
    });

    it("forwards the supported four second Muse duration without replacing it with the default", () => {
        const request = buildVideoProviderRequest("muse_video", {
            ...base,
            model: "muse-video",
            durationSeconds: 4,
        });

        expect(request.body.seconds).toBe(4);
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

        expect(muse.body).not.toHaveProperty("seconds");
        expect(grok.body).not.toHaveProperty("duration");
    });

    it("maps the workbench 1280x720 and 5 second selection to vendor-native fields", () => {
        const input = { ...base, durationSeconds: 5, resolution: "720p", aspectRatio: "16:9" };

        const muse = buildVideoProviderRequest("muse_video", input);
        expect(muse.body).toMatchObject({ seconds: 5, aspect_ratio: "16:9" });

        const grok = buildVideoProviderRequest("grok", input);
        expect(grok.body).toMatchObject({ duration: 5, resolution: "720p", aspect_ratio: "16:9" });

        const seedance = buildVideoProviderRequest("seedance_video", input);
        expect(seedance.body).toMatchObject({ duration: 5, resolution: "720p", aspect_ratio: "16:9" });
    });

    it("uses the MiniMax task protocol body", () => {
        const request = buildVideoProviderRequest("video_tasks", {
            ...base,
            model: "minimax-h3",
            resolution: "1080p",
        });

        expect(request.path).toBe("/videos");
        expect(request.body).toMatchObject({
            seconds: "8",
            resolution: "768P",
            ratio: "16:9",
            images: ["https://cdn.example.com/frame.png"],
        });
    });
});
