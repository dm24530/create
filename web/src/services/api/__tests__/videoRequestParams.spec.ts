import { readFileSync } from "node:fs";
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
import { getVideoModelProfile, isVideoDurationOptionAllowed, isVideoRatioSupported, isVideoResolutionSupported, resolveVideoModeProfile, type VideoCapabilityProfile, type VideoModelProvider } from "@/lib/video-model-profile";
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

    it("passes image, video and audio reference URLs together in the mock request", () => {
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
        expect(SEEDANCE_VIDEO_CAPABILITY.slots?.reference_image).toBeGreaterThan(0);
        expect(SEEDANCE_VIDEO_CAPABILITY.slots?.reference_video).toBeGreaterThan(0);
        expect(SEEDANCE_VIDEO_CAPABILITY.slots?.reference_audio).toBeGreaterThan(0);
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

    it("supports arbitrary future modes and parameters without model-name branches", () => {
        const capability: VideoCapabilityProfile = {
            protocol: "seedance_video",
            min_duration: 6,
            max_duration: 24,
            default_duration: 12,
            resolutions: ["4k"],
            aspect_ratios: ["adaptive"],
            slots: { first_frame: 0, last_frame: 0, reference_image: 30, reference_video: 10, reference_audio: 10 },
            modes: ["text-to-video", "reference-images", "reference-video", "video-edit"],
            supports_generate_audio: true,
            parameters: [
                { key: "seed", type: "integer", default: 42 },
                { key: "watermark", type: "boolean", default: false },
            ],
        };
        const profile = getVideoModelProfile("future-supplier-model", capability);
        const request = withProfile("seedance_video", capability, {
            ...base,
            model: "future-supplier-model",
            durationSeconds: 12,
            resolution: "4k",
            aspectRatio: "auto",
            imageMode: "reference",
            selectedMode: "video-edit",
            videoUrls: ["https://cdn.example.com/source.mp4"],
            parameters: { seed: 7, watermark: true },
        });

        expect(request.path).toBe("/video/generations");
        expect(request.body).toMatchObject({
            model: "future-supplier-model",
            mode: "video-edit",
            resolution: "4k",
            aspect_ratio: "adaptive",
            reference_video_urls: ["https://cdn.example.com/source.mp4"],
            seed: 7,
            watermark: true,
        });
        expect(profile.maxImages).toBe(30);
        expect(profile.maxVideos).toBe(10);
        expect(profile.maxAudios).toBe(10);
    });

    it("fails closed when a structured protocol receives generic media_fields", () => {
        const capability: VideoCapabilityProfile = {
            ...SEEDANCE_VIDEO_CAPABILITY,
            protocol: "seedance",
            request_schema: { media_fields: { reference_images: "custom_images" } },
        };
        expect(() => withProfile("seedance", capability, { ...base, model: "structured-model" })).toThrow(/media_fields/);
    });

    it("uses declarative paths and media fields for a new protocol", () => {
        const capability: VideoCapabilityProfile = {
            protocol: "future_supplier_v2",
            min_duration: 4,
            max_duration: 20,
            default_duration: 8,
            resolutions: ["1080p", "4k"],
            aspect_ratios: ["16:9", "adaptive"],
            slots: { first_frame: 0, last_frame: 0, reference_image: 8, reference_video: 2, reference_audio: 2 },
            modes: ["text-to-video", "reference-images", "video-edit"],
            supports_generate_audio: true,
            request_schema: {
                create_path: "/future/video/jobs",
                task_path: "/future/video/jobs/{id}?model={model}",
                content_path: "/future/video/jobs/{id}/content",
                media_fields: {
                    edit_video: { field: "source_video", multiple: false },
                    reference_images: { field: "reference_assets", multiple: true },
                    reference_audio: { field: "audio_assets", multiple: true },
                },
            },
        };
        const profile = getVideoModelProfile("another-new-model", capability);
        const request = withProfile("future_supplier_v2", capability, {
            ...base,
            model: "another-new-model",
            selectedMode: "video-edit",
            videoUrls: ["https://cdn.example.com/source.mp4"],
            imageUrls: ["https://cdn.example.com/ref.png"],
            audioUrls: ["https://cdn.example.com/ref.mp3"],
        });

        expect(request.path).toBe("/future/video/jobs");
        expect(request.body).toMatchObject({
            model: "another-new-model",
            mode: "video-edit",
            source_video: "https://cdn.example.com/source.mp4",
            reference_assets: ["https://cdn.example.com/ref.png"],
            audio_assets: ["https://cdn.example.com/ref.mp3"],
        });
        expect(request.body).not.toHaveProperty("reference_video_urls");
        expect(videoTaskPath(profile.provider, "job 1", "another-new-model", profile.requestSchema)).toBe("/future/video/jobs/job%201?model=another-new-model");
        expect(videoContentPath(profile.provider, "job 1", "another-new-model", profile.requestSchema)).toBe("/future/video/jobs/job%201/content");
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
    const path = resolve(process.cwd(), "src/lib/__tests__/fixtures/video-capability-catalog.json");
    return JSON.parse(readFileSync(path, "utf8")) as Array<{ model_name: string; capabilities: VideoCapabilityProfile }>;
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

type Mock31CatalogEntry = {
    model_name: string;
    docs_provider: string;
    capabilities: VideoCapabilityProfile;
};

function loadMomo31Catalog(): Mock31CatalogEntry[] {
    const path = resolve(process.cwd(), "src/lib/__tests__/fixtures/momoapi-video-31.json");
    return (JSON.parse(readFileSync(path, "utf8")) as { models: Mock31CatalogEntry[] }).models;
}

const momo31Catalog = loadMomo31Catalog();

describe("momo docs 31-model mock without network", () => {
    it("contains the current 31 documented models", () => {
        expect(momo31Catalog).toHaveLength(31);
        expect(new Set(momo31Catalog.map((entry) => entry.model_name)).size).toBe(31);
        const newlyObserved = [
            "seedance 2.0 fast-OvO",
            "seedance 2.0 mini-OvO",
            "seedance 2.0 mini-OvO-Pack",
            "seedance-2.0-fast-zq",
            "seedance-2.0-zq",
            "seedance-2.5-acrux",
            "seedance-2.5-alphard",
            "seedance2.5 GouGou",
        ];
        expect(newlyObserved.every((name) => momo31Catalog.some((entry) => entry.model_name === name))).toBe(true);
    });

    it("keeps 1080p visible for the model but rejects it in a 480p/720p-only mode", () => {
        const entry = momo31Catalog.find((item) => item.model_name === "grok-imagine-video-1.5");
        expect(entry?.capabilities.mode_capabilities?.["first-last-frame"]?.resolution_options).toEqual(["480p", "720p"]);
        const profile = getVideoModelProfile("grok-imagine-video-1.5", entry?.capabilities);
        expect(isVideoResolutionSupported(profile, "1080", "text-to-video")).toBe(true);
        expect(isVideoResolutionSupported(profile, "1080", "first-last-frame")).toBe(false);
        expect(resolveVideoModeProfile(profile, "first-last-frame").resolutions).toEqual(["480", "720"]);

        const request = buildVideoProviderRequest(profile.provider, {
            ...base,
            model: "grok-imagine-video-1.5",
            resolution: "1080p",
            selectedMode: "first-last-frame",
            imageUrls: ["https://cdn.example.com/first.png", "https://cdn.example.com/last.png"],
        }, profile);
        expect(request.body.resolution).toBe("480p");
    });

    describe.each(momo31Catalog.map((entry) => [entry.model_name, entry] as const))("%s", (name, entry) => {
        it("builds every declared mode with only documented media fields", () => {
            const profile = getVideoModelProfile(name, entry.capabilities);
            expect(profile.provider).toBe("momo_video");
            expect(profile.maxImages).toBeGreaterThanOrEqual(entry.capabilities.slots?.reference_image || 0);

            for (const mode of entry.capabilities.modes || []) {
                const imageUrls: string[] = [];
                const videoUrls: string[] = [];
                const audioUrls: string[] = [];
                if (mode === "image-to-video") imageUrls.push("https://mock.local/frame.png");
                if (mode === "first-last-frame" || mode === "keyframes") imageUrls.push("https://mock.local/first.png", "https://mock.local/last.png");
                if (mode === "reference-images") imageUrls.push("https://mock.local/ref.png");
                if (mode === "reference-video") {
                    if ((entry.capabilities.slots?.reference_image || 0) > 0) imageUrls.push("https://mock.local/ref.png");
                    if ((entry.capabilities.slots?.reference_video || 0) > 0) videoUrls.push("https://mock.local/ref.mp4");
                    if ((entry.capabilities.slots?.reference_audio || 0) > 0) audioUrls.push("https://mock.local/ref.mp3");
                }
                if (mode === "video-edit" || mode === "video-extension") {
                    videoUrls.push("https://mock.local/source.mp4");
                    if ((entry.capabilities.slots?.reference_image || 0) > 0) imageUrls.push("https://mock.local/ref.png");
                    if ((entry.capabilities.slots?.reference_audio || 0) > 0) audioUrls.push("https://mock.local/ref.mp3");
                }

                const request = buildVideoProviderRequest(profile.provider, {
                    model: name,
                    prompt: `mock ${mode}`,
                    durationSeconds: profile.defaultDuration,
                    resolution: profile.resolutions[0],
                    aspectRatio: profile.aspectRatios[0],
                    generateAudio: profile.supportsGenerateAudio,
                    imageUrls,
                    videoUrls,
                    audioUrls,
                    selectedMode: mode,
                    parameters: {
                        seed: 7,
                        negative_prompt: "low quality",
                    },
                }, profile);

                expect(request.path).toBe("/video/generations");
                expect(request.body.model).toBe(name);
                if (mode === "video-edit" || mode === "video-extension") {
                    expect(request.body.mode).toBe(mode);
                } else {
                    expect(request.body).not.toHaveProperty("mode");
                }
                if (mode === "first-last-frame") {
                    expect(request.body.first_frame_image_url).toBe(imageUrls[0]);
                    expect(request.body.last_frame_image_url).toBe(imageUrls[1]);
                } else if (mode === "image-to-video") {
                    expect(request.body.images).toEqual([imageUrls[0]]);
                    expect(request.body).not.toHaveProperty("first_frame_image_url");
                } else if (mode === "keyframes") {
                    expect(request.body.keyframes).toEqual(imageUrls.map((image_url, index) => ({ timestamp_s: index + 1, image_url })));
                    expect(request.body).not.toHaveProperty("keyframe_image_urls");
                } else if (imageUrls.length && mode !== "video-edit" && mode !== "video-extension") {
                    expect(request.body.reference_image_urls).toEqual(imageUrls);
                }
                if (videoUrls.length) {
                    if (mode === "video-edit" || mode === "video-extension") {
                        expect(request.body.reference_video_url).toBe(videoUrls[0]);
                        expect(request.body).not.toHaveProperty("reference_video_urls");
                    } else {
                        expect(request.body.reference_video_urls).toEqual(videoUrls);
                    }
                }
                if (mode === "video-edit" || mode === "video-extension") {
                    expect(request.body).not.toHaveProperty("reference_image_urls");
                    expect(request.body).not.toHaveProperty("reference_audio_urls");
                } else if (audioUrls.length) {
                    expect(request.body.reference_audio_urls).toEqual(audioUrls);
                }
                expect(videoTaskPath(profile.provider, "task id", name, profile.requestSchema)).toBe("/videos/task%20id");
                expect(videoContentPath(profile.provider, "task id", name, profile.requestSchema)).toBe("/videos/task%20id/content");
            }
        });
    });
});
