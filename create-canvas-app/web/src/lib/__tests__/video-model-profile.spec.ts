import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    clampVideoSecondsForProfile,
    getVideoModelProfile,
    isVideoDurationOptionAllowed,
    isVideoResolutionSupported,
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