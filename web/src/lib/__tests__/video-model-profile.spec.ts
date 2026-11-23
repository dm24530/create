import { describe, expect, it } from "vitest";

import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoDurationOptionAllowed, isVideoResolutionSupported, resolveVideoModelProvider } from "../video-model-profile";

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

    it("uses the documented Seedance 2.5 tiers and reference limits", () => {
        const profile = getVideoModelProfile("seedance-2.5");

        expect(profile.provider).toBe("seedance_video");
        expect(profile.resolutions).toEqual(["480", "720"]);
        expect(profile.maxDuration).toBe(30);
        expect(profile.maxImages).toBe(30);
        expect(profile.maxVideos).toBe(10);
        expect(profile.maxAudios).toBe(10);
        expect(profile.supportsGenerateAudio).toBe(true);
    });

    it("matches documented aliases without falling back to generic limits", () => {
        const gt = getVideoModelProfile("seedance 2.5-GT");

        expect(gt.provider).toBe("seedance_video");
        expect(gt.minDuration).toBe(4);
        expect(gt.maxDuration).toBe(15);
        expect(gt.maxVideos).toBe(10);
        expect(gt.maxAudios).toBe(10);
        expect(gt.resolutions).toEqual(["480", "720", "1080"]);
    });

    it("enables Wan Yuanlian reference video and audio", () => {
        const profile = getVideoModelProfile("wan3.0-yuanlian");

        expect(profile.maxImages).toBe(10);
        expect(profile.maxVideos).toBe(5);
        expect(profile.maxAudios).toBe(5);
    });

    it("distinguishes MiniMax H3 from H3-self reference capabilities", () => {
        const profile = getVideoModelProfile("minimax-h3-2026");
        const h3 = getVideoModelProfile("minimax H3");
        const h3Self = getVideoModelProfile("minimax H3-self");

        expect(profile.provider).toBe("video_tasks");
        expect(h3.maxVideos).toBe(0);
        expect(h3.maxAudios).toBe(0);
        expect(h3Self.maxVideos).toBe(0);
        expect(h3Self.maxAudios).toBe(3);
        expect(h3Self.resolutions).toEqual(["480", "768"]);
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

    it("matches documented duration defaults and presets", () => {
        expect(getVideoModelProfile("muse-video").defaultDuration).toBe(6);
        expect(getVideoModelProfile("grok-imagine-video-1.5").defaultDuration).toBe(5);
        expect(getVideoModelProfile("minimax H3").defaultDuration).toBe(15);
        expect(getVideoModelProfile("seedance 2.0 fast-GT").durationOptions).toEqual([10, 15]);
        expect(getVideoModelProfile("seedance 2.0 fast-GT").defaultDuration).toBe(15);
        expect(getVideoModelProfile("seedance-2.0-mini-Chovy").durationOptions).toEqual([5, 10, 15]);
        expect(getVideoModelProfile("seedance-2.5-alioth").defaultDuration).toBe(30);
        expect(getVideoModelProfile("seedance-2.5-merak").defaultDuration).toBe(30);
        expect(getVideoModelProfile("wan3.0-yuanlian").defaultDuration).toBe(2);
    });

    it("routes OpenAI Ark channels through the Ark task protocol", () => {
        const provider = resolveVideoModelProvider("seedance 2.5-GT", {
            baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
            apiFormat: "openai",
            channelPlatform: "openai",
        });

        expect(provider).toBe("seedance");
    });

    it("keeps Wan Yuanlian on the unified gateway protocol", () => {
        const provider = resolveVideoModelProvider("wan3.0-yuanlian", {
            baseUrl: "https://create.superai.sbs/v1",
            apiFormat: "openai",
            channelPlatform: "openai",
        });

        expect(provider).toBe("seedance_video");
    });

    it("keeps unified gateway, Muse, MiniMax and Grok routes distinct", () => {
        expect(resolveVideoModelProvider("seedance-2.5", {
            baseUrl: "https://momoapi.xin/v1",
            apiFormat: "openai",
            channelPlatform: "openai",
        })).toBe("seedance_video");
        expect(resolveVideoModelProvider("muse-video", {
            baseUrl: "https://example.com/v1",
            apiFormat: "openai",
            channelPlatform: "openai",
        })).toBe("muse_video");
        expect(resolveVideoModelProvider("minimax H3-self", {
            baseUrl: "https://example.com/v1",
            apiFormat: "openai",
            channelPlatform: "openai",
        })).toBe("video_tasks");
        expect(resolveVideoModelProvider("grok-imagine-video-1.5", {
            baseUrl: "https://api.x.ai/v1",
            apiFormat: "openai",
            channelPlatform: "grok",
        })).toBe("grok");
    });
});
