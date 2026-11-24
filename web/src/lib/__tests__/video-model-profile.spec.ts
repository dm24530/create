import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    clampVideoSecondsForProfile,
    getVideoModelProfile,
    isVideoDurationOptionAllowed,
    isVideoResolutionSupported,
    isVideoModeSupported,
    resolveVideoModeMediaPolicy,
    resolveVideoModeForReferencePlan,
    resolveVideoModeProfile,
    resolveVideoResolutionForProfile,
    resolveVideoParameterValues,
    videoDurationChoices,
    videoModeChoices,
    videoResolutionChoices,
    type VideoCapabilityProfile,
} from "../video-model-profile";

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

function loadCatalog(): Array<{ model_name: string; capabilities: VideoCapabilityProfile }> {
    const path = resolve(process.cwd(), "src/lib/__tests__/fixtures/video-capability-catalog.json");
    return JSON.parse(readFileSync(path, "utf8")) as Array<{ model_name: string; capabilities: VideoCapabilityProfile }>;
}

const catalog = loadCatalog();

describe("video model profiles", () => {
    it("builds the Muse profile from server capability data", () => {
        const profile = getVideoModelProfile("muse-video", MUSE_CAPABILITY);

        expect(profile.provider).toBe("muse_video");
        expect(profile.resolutions).toEqual(["720"]);
        expect(profile.aspectRatios).toEqual(["16:9", "9:16"]);
        expect(isVideoResolutionSupported(profile, "480")).toBe(false);
        expect(isVideoResolutionSupported(profile, "720")).toBe(true);
        expect(profile.supportsGenerateAudio).toBe(false);
    });

    it("uses configured duration options instead of model-name rules", () => {
        const profile = getVideoModelProfile("renamed-model-without-a-known-name", {
            ...MUSE_CAPABILITY,
            min_duration: 5,
            max_duration: 30,
            default_duration: 10,
            duration_options: [5, 10, 20, 30],
        });

        expect(isVideoDurationOptionAllowed(profile, 15)).toBe(false);
        expect(isVideoDurationOptionAllowed(profile, 20)).toBe(true);
        expect(clampVideoSecondsForProfile("15", profile)).toBe("10");
    });

    it("falls back safely when capability metadata is absent", () => {
        const profile = getVideoModelProfile("unknown-model");

        expect(profile.provider).toBe("openai_video");
        expect(profile.defaultDuration).toBeGreaterThan(0);
        expect(profile.resolutions.length).toBeGreaterThan(0);
        expect(profile.aspectRatios).toEqual(["16:9"]);
    });

    it("applies upstream per-mode resolution and duration limits", () => {
        const profile = getVideoModelProfile("grok-imagine-video-1.5", {
            ...MUSE_CAPABILITY,
            resolutions: ["480p", "720p", "1080p"],
            min_duration: 1,
            max_duration: 15,
            modes: ["text-to-video", "first-last-frame"],
            mode_capabilities: {
                "text-to-video": { resolution_options: ["480p", "720p", "1080p"] },
                "first-last-frame": { resolution_options: ["480p", "720p"], duration_min_seconds: 4, duration_max_seconds: 10 },
            },
        });

        const firstLast = resolveVideoModeProfile(profile, "first-last-frame");
        expect(firstLast.resolutions).toEqual(["480", "720"]);
        expect(firstLast.minDuration).toBe(4);
        expect(firstLast.maxDuration).toBe(10);
        expect(isVideoResolutionSupported(profile, "1080", "first-last-frame")).toBe(false);
        expect(isVideoResolutionSupported(profile, "1080", "text-to-video")).toBe(true);
        expect(videoResolutionChoices(profile, "first-last-frame")).toEqual(expect.arrayContaining(["480", "720", "1080", "4k"]));
        expect(videoResolutionChoices(profile, "first-last-frame")).not.toEqual(expect.arrayContaining(["2k", "8k"]));
    });

    it("defaults image uploads to the reference-image mode", () => {
        const profile = getVideoModelProfile("grok-imagine-video-1.5", {
            ...MUSE_CAPABILITY,
            modes: ["text-to-video", "image-to-video", "first-last-frame", "reference-images", "reference-video", "video-edit"],
            slots: { first_frame: 1, last_frame: 1, reference_image: 7, reference_video: 0, reference_audio: 0 },
        });
        expect(resolveVideoModeForReferencePlan(profile, "auto", { imageRoles: ["reference"], imageCount: 1, videoCount: 0, audioCount: 0 })).toBe("reference-images");
        expect(resolveVideoModeForReferencePlan(profile, "auto", { imageRoles: ["first_frame"], imageCount: 1, videoCount: 0, audioCount: 0 })).toBe("image-to-video");
        expect(resolveVideoModeForReferencePlan(profile, "auto", { imageRoles: ["first_frame", "last_frame"], imageCount: 2, videoCount: 0, audioCount: 0 })).toBe("first-last-frame");
        expect(resolveVideoModeForReferencePlan(profile, "auto", { imageRoles: [], imageCount: 0, videoCount: 1, audioCount: 0 })).toBe("reference-video");
        expect(resolveVideoModeForReferencePlan(profile, "video-edit", { imageRoles: [], imageCount: 0, videoCount: 1, audioCount: 0 })).toBe("video-edit");
    });

    it("presents 768p capabilities as the 720p UI tier", () => {
        const profile = getVideoModelProfile("minimax H3-self", {
            ...MUSE_CAPABILITY,
            resolutions: ["480p", "768p"],
            aspect_ratios: ["16:9", "9:16"],
        });
        expect(videoResolutionChoices(profile)).toEqual(["480", "720", "1080", "4k"]);
        expect(videoResolutionChoices(profile)).not.toContain("768");
        expect(isVideoResolutionSupported(profile, "720")).toBe(true);
        expect(resolveVideoResolutionForProfile(profile, "720")).toBe("768");
    });

    it("keeps unsupported mode and duration buttons as disabled candidates", () => {
        const profile = getVideoModelProfile("muse-video", MUSE_CAPABILITY);

        expect(videoModeChoices(profile)).toEqual(expect.arrayContaining(["text-to-video", "reference-images", "video-edit", "keyframes"]));
        expect(isVideoModeSupported(profile, "video-edit")).toBe(false);
        expect(isVideoModeSupported(profile, "reference-images")).toBe(true);
        expect(videoDurationChoices(profile)).toEqual(expect.arrayContaining([1, 5, 10, 15, 30]));
        expect(isVideoDurationOptionAllowed(profile, 1, "reference-images")).toBe(true);
        expect(isVideoDurationOptionAllowed(profile, 30, "reference-images")).toBe(false);
    });

    it("maps arbitrary future capability metadata without model-name branches", () => {
        const profile = getVideoModelProfile("future-supplier-model", {
            protocol: "future_unified_protocol",
            min_duration: 6,
            max_duration: 24,
            default_duration: 12,
            resolutions: ["1080p", "4k"],
            aspect_ratios: ["16:9", "adaptive"],
            slots: { first_frame: 0, last_frame: 0, reference_image: 30, reference_video: 10, reference_audio: 10 },
            max_images: 30,
            modes: ["text-to-video", "reference-images", "reference-video", "video-edit"],
            frame_reference_exclusive: true,
            reference_image_free_count: 5,
            reference_image_extra_price: 0.18,
            reference_video_billing_mode: "sum_seconds",
            file_limits: { image_bytes: 10, video_bytes: 20, audio_bytes: 30, total_bytes: 40 },
            parameters: [{ key: "seed", label: "随机种子", type: "integer", min: 1, max: 9999 }],
            request_schema: {
                create_path: "/future/video/jobs",
                task_path: "/future/video/jobs/{id}?model={model}",
                content_path: "/future/video/jobs/{id}/content",
                media_fields: { edit_video: { field: "source_video", multiple: false } },
            },
        });

        expect(profile.provider).toBe("future_unified_protocol");

        expect(profile.maxImages).toBe(30);
        expect(profile.maxVideos).toBe(10);
        expect(profile.maxAudios).toBe(10);
        expect(profile.resolutions).toEqual(["1080", "4k"]);
        expect(profile.aspectRatios).toEqual(["16:9", "auto"]);
        expect(profile.supportsAdaptiveRatio).toBe(true);
        expect(profile.frameReferenceExclusive).toBe(true);
        expect(profile.referenceImageFreeCount).toBe(5);
        expect(profile.referenceImageExtraPrice).toBe(0.18);
        expect(profile.referenceVideoBillingMode).toBe("sum_seconds");
        expect(profile.fileLimits).toEqual({ imageBytes: 10, videoBytes: 20, audioBytes: 30, totalBytes: 40 });
        expect(profile.parameters[0].key).toBe("seed");
        expect(profile.requestSchema.create_path).toBe("/future/video/jobs");
        expect(profile.requestSchema.media_fields?.edit_video).toEqual({ field: "source_video", multiple: false });
        expect(isVideoModeSupported(profile, "video-edit")).toBe(true);
    });


    it("uses mode-specific media limits instead of model-wide maxima", () => {
        const profile = getVideoModelProfile("mode-policy-model", {
            protocol: "future_protocol",
            min_duration: 4,
            max_duration: 20,
            default_duration: 8,
            slots: { first_frame: 1, last_frame: 1, reference_image: 7, reference_video: 3, reference_audio: 2, keyframes: 4 },
            modes: ["text-to-video", "image-to-video", "first-last-frame", "reference-video", "keyframes"],
            request_schema: {
                media_fields: { keyframes: "keyframe_image_urls" },
                mode_media: { keyframes: { image_role: "keyframes", max_images: 4 } },
            },
        });

        expect(resolveVideoModeMediaPolicy(profile, "text-to-video")).toMatchObject({ max_images: 0, max_videos: 0, max_audios: 0 });
        expect(resolveVideoModeMediaPolicy(profile, "image-to-video")).toMatchObject({ max_images: 1, max_videos: 0, max_audios: 0 });
        expect(resolveVideoModeMediaPolicy(profile, "first-last-frame")).toMatchObject({ max_images: 2, max_videos: 0, max_audios: 0 });
        expect(resolveVideoModeMediaPolicy(profile, "reference-video")).toMatchObject({ max_images: 7, max_videos: 3, max_audios: 2 });
        expect(resolveVideoModeMediaPolicy(profile, "keyframes")).toMatchObject({ image_role: "keyframes", max_images: 4, max_videos: 0 });
    });

    it("normalizes declared parameters without knowing any vendor", () => {
        const profile = getVideoModelProfile("generic-parameter-model", {
            protocol: "generic_protocol",
            min_duration: 4,
            max_duration: 12,
            default_duration: 8,
            parameters: [
                { key: "seed", type: "integer", min: 1, max: 100, default: 42 },
                { key: "quality", type: "enum", options: ["standard", "high"], default: "standard" },
                { key: "watermark", type: "boolean", default: false },
                { key: "negative_prompt", type: "string", default: "" },
            ],
        });

        expect(resolveVideoParameterValues(profile, {
            seed: 999,
            quality: "unknown",
            watermark: "true",
            negative_prompt: "blurry",
        })).toEqual({
            seed: 100,
            quality: "standard",
            watermark: true,
            negative_prompt: "blurry",
        });
    });

    it("contains and normalizes the complete current 23-model catalog", () => {
        expect(catalog).toHaveLength(23);
        expect(new Set(catalog.map((entry) => entry.model_name)).size).toBe(23);

        for (const entry of catalog) {
            const profile = getVideoModelProfile(entry.model_name, entry.capabilities);
            expect(profile.provider).toBe(entry.capabilities.protocol);
            expect(profile.minDuration).toBeGreaterThan(0);
            expect(profile.maxDuration).toBeGreaterThanOrEqual(profile.minDuration);
            expect(profile.defaultDuration).toBeGreaterThanOrEqual(profile.minDuration);
            expect(profile.defaultDuration).toBeLessThanOrEqual(profile.maxDuration);
            expect(profile.resolutions.length).toBeGreaterThan(0);
            expect(profile.aspectRatios.length).toBeGreaterThan(0);
            expect(profile.maxImages).toBeGreaterThanOrEqual(0);
            expect(profile.maxVideos).toBeGreaterThanOrEqual(0);
            expect(profile.maxAudios).toBeGreaterThanOrEqual(0);
        }
    });
});