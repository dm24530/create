import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { inferVideoRatio } from "@/lib/media-size";
import { getVideoModelProfile, isVideoDurationOptionAllowed, isVideoRatioSupported, isVideoResolutionSupported, type VideoCapabilityProfile, type VideoModelProvider } from "@/lib/video-model-profile";
import { createModelChannel, defaultConfig, encodeChannelModel, modelOptionName, videoCapabilityOf } from "@/stores/use-config-store";
import { buildVideoProviderRequest, isRetryableVideoPollingError, VideoPollingError, videoContentPath, videoTaskPath, type VideoProviderRequestInput } from "../video";

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

const MUSE_CAPABILITY: VideoCapabilityProfile = {
    protocol: "muse_video",
    min_duration: 1,
    max_duration: 15,
    default_duration: 10,
    resolutions: ["720p"],
    aspect_ratios: ["16:9", "9:16"],
    slots: { first_frame: 0, last_frame: 0, reference_image: 4, reference_video: 0, reference_audio: 0 },
    supports_generate_audio: false,
    modes: ["text-to-video", "reference-images"],
};

const GROK_CAPABILITY: VideoCapabilityProfile = {
    protocol: "grok",
    min_duration: 1,
    max_duration: 10,
    default_duration: 8,
    resolutions: ["480p", "720p"],
    aspect_ratios: ["16:9", "9:16"],
    slots: { first_frame: 1, last_frame: 1, reference_image: 7, reference_video: 1, reference_audio: 0 },
    supports_generate_audio: false,
    modes: ["text-to-video", "image-to-video", "reference-images"],
};

const SEEDANCE_VIDEO_CAPABILITY: VideoCapabilityProfile = {
    protocol: "seedance_video",
    min_duration: 4,
    max_duration: 30,
    default_duration: 5,
    resolutions: ["480p", "720p", "1080p"],
    aspect_ratios: ["16:9", "9:16", "1:1"],
    slots: { first_frame: 1, last_frame: 1, reference_image: 9, reference_video: 3, reference_audio: 3 },
    supports_generate_audio: true,
    modes: ["text-to-video", "image-to-video", "first-last-frame", "reference-images", "reference-video"],
};

const MINIMAX_CAPABILITY: VideoCapabilityProfile = {
    protocol: "video_tasks",
    min_duration: 4,
    max_duration: 15,
    default_duration: 15,
    resolutions: ["480p"],
    aspect_ratios: ["16:9", "9:16", "1:1"],
    slots: { first_frame: 0, last_frame: 0, reference_image: 9, reference_video: 0, reference_audio: 0 },
    supports_generate_audio: false,
    modes: ["text-to-video", "reference-images"],
};

function withProfile(provider: VideoModelProvider, capability: VideoCapabilityProfile, input: VideoProviderRequestInput) {
    return buildVideoProviderRequest(provider, input, getVideoModelProfile(input.model, capability));
}

describe("video polling retry policy", () => {
    it("retries transient network, timeout and server errors but not auth failures", () => {
        expect(isRetryableVideoPollingError(new VideoPollingError("offline", 0))).toBe(true);
        expect(isRetryableVideoPollingError(new VideoPollingError("timeout", 408))).toBe(true);
        expect(isRetryableVideoPollingError(new VideoPollingError("busy", 503))).toBe(true);
        expect(isRetryableVideoPollingError(new VideoPollingError("auth", 401))).toBe(false);
        expect(isRetryableVideoPollingError(new VideoPollingError("forbidden", 403))).toBe(false);
    });
});
describe("video task protocol paths", () => {
    it("uses the Seedance native task and content endpoints", () => {
        expect(videoTaskPath("seedance", "task id", "seedance-2.0")).toBe("/contents/generations/tasks/task%20id");
        expect(videoContentPath("seedance", "task id", "seedance-2.0")).toBe("/contents/generations/tasks/task%20id/content");
    });

    it("uses model-aware paths for unified video protocols", () => {
        expect(videoTaskPath("muse_video", "task-1", "muse-video")).toBe("/videos/task-1?model=muse-video");
        expect(videoContentPath("video_tasks", "task-1", "minimax H3")).toBe("/videos/task-1/content?model=minimax%20H3");
        expect(videoTaskPath("grok", "task-1", "grok-imagine-video")).toBe("/videos/task-1");
        expect(videoContentPath("grok", "task-1", "grok-imagine-video")).toBe("/videos/task-1/content");
    });
});
describe("vendor video request builders", () => {
    it("uses the capability-driven unified video protocol for Muse", () => {
        const request = withProfile("muse_video", MUSE_CAPABILITY, {
            ...base,
            model: "muse-video",
            aspectRatio: "9:16",
            imageMode: "reference",
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            model: "muse-video",
            prompt: "a cat running",
            duration: 8,
            aspect_ratio: "9:16",
            reference_image_urls: ["https://cdn.example.com/frame.png"],
        });
        expect(request.body).not.toHaveProperty("seconds");
        expect(request.body).not.toHaveProperty("generate_audio");
    });

    it("uses capability-driven Grok fields without a model-name branch", () => {
        const request = withProfile("grok", GROK_CAPABILITY, {
            ...base,
            model: "renamed-grok-model",
            resolution: "480p",
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            model: "renamed-grok-model",
            mode: "image-to-video",
            duration: 8,
            resolution: "480p",
            aspect_ratio: "16:9",
            first_frame_image_url: "https://cdn.example.com/frame.png",
        });
        expect(request.body).not.toHaveProperty("seconds");
    });

    it("sends Seedance Video references and audio only when capabilities allow them", () => {
        const request = withProfile("seedance_video", SEEDANCE_VIDEO_CAPABILITY, {
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
            reference_image_urls: ["https://cdn.example.com/frame.png"],
            reference_video_urls: ["https://cdn.example.com/ref.mp4"],
            reference_audio_urls: ["https://cdn.example.com/ref.mp3"],
        });
    });

    it("omits unsupported vendor duration fields in automatic duration mode", () => {
        const muse = withProfile("muse_video", MUSE_CAPABILITY, {
            ...base,
            model: "muse-video",
            durationAuto: true,
        });
        const grok = withProfile("grok", GROK_CAPABILITY, {
            ...base,
            model: "grok-imagine-video",
            durationAuto: true,
        });

        expect(muse.body).not.toHaveProperty("duration");
        expect(grok.body).not.toHaveProperty("duration");
    });

    it("routes MiniMax through the same capability-driven protocol", () => {
        const request = withProfile("video_tasks", MINIMAX_CAPABILITY, {
            ...base,
            model: "minimax-h3",
            resolution: "480p",
            imageMode: "reference",
            imageUrls: ["https://cdn.example.com/ref.png"],
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            duration: 8,
            resolution: "480p",
            aspect_ratio: "16:9",
            reference_image_urls: ["https://cdn.example.com/ref.png"],
        });
    });
});

function loadCatalog(): Array<{ model_name: string; capabilities: VideoCapabilityProfile }> {
    const sql = readFileSync(resolve(process.cwd(), "../../backend/migrations/276_channel_video_capabilities.sql"), "utf8");
    const start = sql.indexOf("$catalog$") + "$catalog$".length;
    const end = sql.indexOf("$catalog$::jsonb", start);
    if (start < "$catalog$".length || end < 0) throw new Error("video capability catalog not found");
    return JSON.parse(sql.slice(start, end)) as Array<{ model_name: string; capabilities: VideoCapabilityProfile }>;
}

describe("all app video models synthetic smoke", () => {
    const catalog = loadCatalog();

    it("contains the current 23 models", () => {
        expect(catalog).toHaveLength(23);
    });

    describe.each(catalog.map((entry) => [entry.model_name, entry] as const))("%s", (_name, entry) => {
        it("builds a valid request from server capabilities", () => {
            const capability = entry.capabilities;
            const profile = getVideoModelProfile(entry.model_name, capability);
            const slots = profile.slots;
            const useFrames = slots.first_frame > 0 || slots.last_frame > 0;
            const imageUrls = useFrames
                ? [
                    ...(slots.first_frame > 0 ? ["https://cdn.example.com/first.png"] : []),
                    ...(slots.last_frame > 0 ? ["https://cdn.example.com/last.png"] : []),
                ]
                : slots.reference_image > 0
                    ? ["https://cdn.example.com/ref.png"]
                    : [];
            const input: VideoProviderRequestInput = {
                model: entry.model_name,
                prompt: "synthetic smoke prompt",
                durationSeconds: profile.defaultDuration,
                resolution: profile.resolutions[0],
                aspectRatio: profile.aspectRatios[0],
                generateAudio: profile.supportsGenerateAudio,
                imageUrls,
                videoUrls: slots.reference_video > 0 ? ["https://cdn.example.com/ref.mp4"] : [],
                audioUrls: slots.reference_audio > 0 ? ["https://cdn.example.com/ref.mp3"] : [],
                imageMode: useFrames ? "frames" : "reference",
            };

            const request = buildVideoProviderRequest(profile.provider, input, profile);
            expect(request.body.model).toBe(entry.model_name);
            if (profile.provider === "seedance") {
                expect(request.path).toBe("/contents/generations/tasks");
                expect(Array.isArray(request.body.content)).toBe(true);
                expect(request.body.ratio).toBe(profile.aspectRatios[0]);
            } else if (profile.provider === "openai_video") {
                expect(request.path).toBe("/videos");
                expect(request.body.seconds).toBe(profile.defaultDuration);
            } else {
                expect(request.path).toBe("/video/generations");
                expect(request.body.prompt).toBe("synthetic smoke prompt");
                expect(request.body.resolution).toBe(`${profile.resolutions[0]}p`);
                expect(request.body.aspect_ratio).toBe(profile.aspectRatios[0]);
                expect(request.body.duration).toBe(profile.defaultDuration);
            }
        });
    });
});
describe("all app video models canvas smoke", () => {
    const catalog = loadCatalog();

    describe.each(catalog.map((entry) => [entry.model_name, entry] as const))("%s", (_name, entry) => {
        it("sanitizes canvas parameters and routes through the same video protocol", () => {
            const channel = createModelChannel({
                id: "managed-video",
                name: "视频",
                baseUrl: "https://example.com/v1",
                apiKey: "sk-test",
                apiFormat: "openai",
                models: [{ name: entry.model_name, capability: "video", videoCapabilities: entry.capabilities }],
            });
            const encodedModel = encodeChannelModel(channel.id, entry.model_name);
            const config = buildGenerationConfig({
                ...defaultConfig,
                channels: [channel],
                model: encodedModel,
                videoModel: encodedModel,
                vquality: "1080",
                size: "1920x1080",
                videoSeconds: String(entry.capabilities.max_duration + 10),
                videoMode: "frames",
            }, undefined, "video");

            const profile = getVideoModelProfile(modelOptionName(config.model), videoCapabilityOf(config, config.model));
            expect(profile.provider).toBe(entry.capabilities.protocol);
            expect(isVideoResolutionSupported(profile, config.vquality)).toBe(true);
            expect(isVideoDurationOptionAllowed(profile, Number(config.videoSeconds))).toBe(true);
            expect(isVideoRatioSupported(profile, inferVideoRatio(config.size))).toBe(true);
        });
    });
});
