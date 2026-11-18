import { videoRatioOptions } from "@/lib/media-size";

export type VideoModelProvider = "muse_video" | "grok" | "seedance_video" | "video_tasks" | "openai_video";

export type VideoModelProfile = {
    provider: VideoModelProvider;
    resolutions: readonly string[];
    aspectRatios: readonly string[];
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
    minDuration: number;
    maxDuration: number;
    defaultDuration: number;
    durationOptions?: readonly number[];
    supportsGenerateAudio: boolean;
};

const ALL_VIDEO_RATIOS = videoRatioOptions.filter((item) => item.value !== "auto").map((item) => item.value);
const DEFAULT_PROFILE: VideoModelProfile = {
    provider: "openai_video",
    resolutions: ["480", "720", "1080"],
    aspectRatios: ALL_VIDEO_RATIOS,
    maxImages: 3,
    maxVideos: 1,
    maxAudios: 1,
    minDuration: 1,
    maxDuration: 15,
    defaultDuration: 5,
    supportsGenerateAudio: true,
};

const MINIMAX_H3_PROFILE: VideoModelProfile = {
    provider: "video_tasks",
    resolutions: ["768"],
    aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 1,
    minDuration: 1,
    maxDuration: 15,
    defaultDuration: 5,
    supportsGenerateAudio: false,
};

const PROFILES: Record<string, VideoModelProfile> = {
    "muse-video": {
        provider: "muse_video",
        resolutions: ["720"],
        aspectRatios: ["16:9", "9:16"],
        maxImages: 4,
        maxVideos: 0,
        maxAudios: 0,
        // momo docs: muse-video supports any integer duration from 1 to 15 seconds.
        minDuration: 1,
        maxDuration: 15,
        defaultDuration: 10,
        supportsGenerateAudio: false,
    },
    "muse-cheap": {
        provider: "muse_video",
        resolutions: ["720"],
        aspectRatios: ["16:9", "9:16"],
        maxImages: 7,
        maxVideos: 0,
        maxAudios: 0,
        minDuration: 1,
        maxDuration: 30,
        defaultDuration: 10,
        durationOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30],
        supportsGenerateAudio: false,
    },
    "grok-imagine-video": {
        provider: "grok",
        resolutions: ["480", "720"],
        aspectRatios: ALL_VIDEO_RATIOS,
        maxImages: 7,
        maxVideos: 1,
        maxAudios: 0,
        minDuration: 1,
        maxDuration: 10,
        defaultDuration: 8,
        supportsGenerateAudio: false,
    },
    "grok-imagine-video-onece": {
        provider: "grok",
        resolutions: ["480", "720"],
        aspectRatios: ALL_VIDEO_RATIOS,
        maxImages: 7,
        maxVideos: 1,
        maxAudios: 0,
        minDuration: 1,
        maxDuration: 10,
        defaultDuration: 8,
        supportsGenerateAudio: false,
    },
    "grok-imagine-video-1.5": {
        provider: "grok",
        resolutions: ["480", "720", "1080"],
        aspectRatios: ALL_VIDEO_RATIOS,
        maxImages: 14,
        maxVideos: 1,
        maxAudios: 0,
        minDuration: 1,
        maxDuration: 15,
        defaultDuration: 8,
        supportsGenerateAudio: true,
    },
    "seedance-2.0": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 9,
        maxVideos: 1,
        maxAudios: 1,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 8,
        supportsGenerateAudio: true,
    },
    "seedance-2.0-fast": {
        provider: "seedance_video",
        resolutions: ["480", "720", "1080"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 9,
        maxVideos: 1,
        maxAudios: 1,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 8,
        supportsGenerateAudio: true,
    },
    "seedance-2.5": {
        provider: "seedance_video",
        resolutions: ["480", "720", "1080"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 30,
        maxVideos: 1,
        maxAudios: 1,
        minDuration: 5,
        maxDuration: 30,
        defaultDuration: 8,
        supportsGenerateAudio: true,
    },
    "wan3.0-video": {
        provider: "seedance_video",
        resolutions: ["720", "1080"],
        aspectRatios: ["16:9", "9:16", "1:1"],
        maxImages: 1,
        maxVideos: 0,
        maxAudios: 0,
        minDuration: 2,
        maxDuration: 30,
        defaultDuration: 5,
        supportsGenerateAudio: false,
    },
    "wan3.0-yuanlian": {
        provider: "seedance_video",
        resolutions: ["480", "720", "1080"],
        aspectRatios: ["16:9", "9:16", "1:1"],
        maxImages: 1,
        maxVideos: 0,
        maxAudios: 0,
        minDuration: 2,
        maxDuration: 30,
        defaultDuration: 5,
        supportsGenerateAudio: false,
    },
};

export function getVideoModelProfile(model: string): VideoModelProfile {
    const value = String(model || "").trim().toLowerCase();
    if (/^minimax[\s_-]*h3(?:$|[^0-9])/.test(value)) return MINIMAX_H3_PROFILE;
    const exact = PROFILES[value];
    if (exact) return exact;
    if (value.includes("muse") && value.includes("cheap")) return PROFILES["muse-cheap"];
    if (value.includes("muse")) return PROFILES["muse-video"];
    if (value.includes("grok-imagine-video-1.5")) return PROFILES["grok-imagine-video-1.5"];
    if (value.includes("grok-imagine-video")) return PROFILES["grok-imagine-video"];
    if (value.includes("seedance-2.0-fast")) return PROFILES["seedance-2.0-fast"];
    if (value.includes("seedance-2.0")) return PROFILES["seedance-2.0"];
    if (value.includes("seedance-2.5")) return PROFILES["seedance-2.5"];
    if (value.includes("wan3.0-yuanlian")) return PROFILES["wan3.0-yuanlian"];
    if (value.includes("wan3.0-video")) return PROFILES["wan3.0-video"];
    return DEFAULT_PROFILE;
}

export function supportsVideoGenerateAudioToggle(profile: VideoModelProfile) {
    return profile.provider === "seedance_video" && profile.supportsGenerateAudio;
}

export function isVideoResolutionSupported(profile: VideoModelProfile, resolution: string) {
    return profile.resolutions.includes(resolution);
}

export function isVideoRatioSupported(profile: VideoModelProfile, ratio: string) {
    return ratio === "auto" ? false : profile.aspectRatios.includes(ratio);
}

export function isVideoDurationOptionAllowed(profile: VideoModelProfile, seconds: number) {
    if (!Number.isFinite(seconds) || seconds < profile.minDuration || seconds > profile.maxDuration) return false;
    return !profile.durationOptions?.length || profile.durationOptions.includes(seconds);
}

export function clampVideoSecondsForProfile(raw: string | number, profile: VideoModelProfile) {
    const parsed = Math.floor(Math.abs(Number(raw)) || profile.defaultDuration);
    const bounded = Math.min(profile.maxDuration, Math.max(profile.minDuration, parsed));
    if (!profile.durationOptions?.length || profile.durationOptions.includes(bounded)) return String(bounded);
    const nearest = profile.durationOptions.reduce((best, option) => {
        const distance = Math.abs(option - bounded);
        const bestDistance = Math.abs(best - bounded);
        return distance < bestDistance || (distance === bestDistance && option < best) ? option : best;
    }, profile.durationOptions[0]);
    return String(nearest);
}
