import { describe, expect, it } from "vitest";

import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoDurationOptionAllowed, isVideoResolutionSupported } from "../video-model-profile";

describe("video model profiles", () => {
    it("restricts muse-video to 720p and its two supported aspect ratios", () => {
        const profile = getVideoModelProfile("muse-video");

        expect(profile.provider).toBe("muse_video");
        expect(profile.resolutions).toEqual(["720"]);
        expect(profile.aspectRatios).toEqual(["16:9", "9:16"]);
        expect(isVideoResolutionSupported(profile, "480")).toBe(false);
        expect(isVideoResolutionSupported(profile, "720")).toBe(true);
        expect(isVideoResolutionSupported(profile, "1080")).toBe(false);
        expect(profile.supportsGenerateAudio).toBe(false);
    });

    it("applies Muse constraints to versioned or aliased Muse model names", () => {
        const profile = getVideoModelProfile("muse-video-preview-2026");

        expect(profile.resolutions).toEqual(["720"]);
        expect(profile.aspectRatios).toEqual(["16:9", "9:16"]);
    });

    it("disables 1080p for the standard grok video model", () => {
        const profile = getVideoModelProfile("grok-imagine-video");

        expect(profile.provider).toBe("grok");
        expect(isVideoResolutionSupported(profile, "480")).toBe(true);
        expect(isVideoResolutionSupported(profile, "720")).toBe(true);
        expect(isVideoResolutionSupported(profile, "1080")).toBe(false);
    });

    it("keeps all three tiers for seedance 2.5", () => {
        const profile = getVideoModelProfile("seedance-2.5");

        expect(profile.provider).toBe("seedance_video");
        expect(profile.resolutions).toEqual(["480", "720", "1080"]);
        expect(profile.maxDuration).toBe(30);
        expect(profile.supportsGenerateAudio).toBe(true);
    });

    it("recognizes MiniMax H3 as the task protocol", () => {
        const profile = getVideoModelProfile("minimax-h3-2026");

        expect(profile.provider).toBe("video_tasks");
        expect(profile.resolutions).toEqual(["768"]);
    });

    it("supports every Muse duration from one to fifteen seconds", () => {
        const museVideo = getVideoModelProfile("muse-video");

        expect(museVideo.maxDuration).toBe(15);
        expect(clampVideoSecondsForProfile("1", museVideo)).toBe("1");
        expect(isVideoDurationOptionAllowed(museVideo, 12)).toBe(true);
        expect(isVideoDurationOptionAllowed(museVideo, 15)).toBe(true);
        expect(isVideoDurationOptionAllowed(museVideo, 16)).toBe(false);
        expect(clampVideoSecondsForProfile("16", museVideo)).toBe("15");
    });

    it("clamps durations to the active model profile", () => {
        const museCheap = getVideoModelProfile("muse-cheap");

        expect(isVideoDurationOptionAllowed(museCheap, 15)).toBe(false);
        expect(isVideoDurationOptionAllowed(museCheap, 20)).toBe(true);
        expect(clampVideoSecondsForProfile("15", museCheap)).toBe("10");
    });
});
