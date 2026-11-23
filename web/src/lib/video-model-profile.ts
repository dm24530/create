import { videoRatioOptions } from "@/lib/media-size";

export type VideoModelProvider = "muse_video" | "grok" | "seedance" | "seedance_video" | "video_tasks" | "openai_video";

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
    maxAudios: 0,
    minDuration: 1,
    maxDuration: 15,
    defaultDuration: 5,
    supportsGenerateAudio: true,
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
        defaultDuration: 6,
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
        maxImages: 7,
        maxVideos: 1,
        maxAudios: 0,
        minDuration: 1,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance-2.0": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 9,
        maxVideos: 1,
        maxAudios: 10,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance-2.0-fast": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 9,
        maxVideos: 1,
        maxAudios: 10,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance-2.5": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 30,
        maxVideos: 10,
        maxAudios: 10,
        minDuration: 5,
        maxDuration: 30,
        defaultDuration: 5,
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
        maxImages: 10,
        maxVideos: 5,
        maxAudios: 5,
        minDuration: 2,
        maxDuration: 30,
        defaultDuration: 2,
        supportsGenerateAudio: false,
    },
    "minimax h3": {
        provider: "video_tasks",
        resolutions: ["480"],
        aspectRatios: ["9:16", "16:9", "1:1", "3:4", "4:3", "3:2", "2:3", "21:9"],
        maxImages: 9,
        maxVideos: 0,
        maxAudios: 0,
        minDuration: 4,
        maxDuration: 15,
        defaultDuration: 15,
        supportsGenerateAudio: false,
    },
    "minimax h3-self": {
        provider: "video_tasks",
        resolutions: ["480", "768"],
        aspectRatios: ["16:9", "9:16"],
        maxImages: 9,
        maxVideos: 0,
        maxAudios: 3,
        minDuration: 1,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: false,
    },
    "seedance 2.0 fast-gt": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
        minDuration: 10,
        maxDuration: 15,
        defaultDuration: 15,
        durationOptions: [10, 15],
        supportsGenerateAudio: true,
    },
    "seedance 2.0 mini-gt": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
        minDuration: 10,
        maxDuration: 15,
        defaultDuration: 15,
        durationOptions: [10, 15],
        supportsGenerateAudio: true,
    },
    "seedance 2.5-gt": {
        provider: "seedance_video",
        resolutions: ["480", "720", "1080"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 30,
        maxVideos: 10,
        maxAudios: 10,
        minDuration: 4,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance-2.0-mini": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["9:16", "16:9", "1:1", "3:4", "4:3"],
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance-2.0-mini-chovy": {
        provider: "seedance_video",
        resolutions: ["720"],
        aspectRatios: ["16:9", "9:16"],
        maxImages: 9,
        maxVideos: 0,
        maxAudios: 0,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 15,
        durationOptions: [5, 10, 15],
        supportsGenerateAudio: false,
    },
    "seedance-2.5-alioth": {
        provider: "seedance_video",
        resolutions: ["720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 30,
        maxVideos: 0,
        maxAudios: 10,
        minDuration: 5,
        maxDuration: 30,
        defaultDuration: 30,
        supportsGenerateAudio: false,
    },
    "seedance-2.5-draft-zq": {
        provider: "seedance_video",
        resolutions: ["480"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
        maxImages: 30,
        maxVideos: 10,
        maxAudios: 10,
        minDuration: 5,
        maxDuration: 30,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance-2.5-flash-zq": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
        maxImages: 10,
        maxVideos: 5,
        maxAudios: 5,
        minDuration: 5,
        maxDuration: 30,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance-2.5-merak": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 10,
        maxVideos: 0,
        maxAudios: 5,
        minDuration: 5,
        maxDuration: 30,
        defaultDuration: 30,
        supportsGenerateAudio: false,
    },
    "seedance2.0 fast deneb": {
        provider: "seedance_video",
        resolutions: ["720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
        maxImages: 9,
        maxVideos: 0,
        maxAudios: 0,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 15,
        durationOptions: [5, 10, 15],
        supportsGenerateAudio: false,
    },
    "seedance2.0 mini love": {
        provider: "seedance_video",
        resolutions: ["480", "720"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        maxImages: 9,
        maxVideos: 0,
        maxAudios: 3,
        minDuration: 5,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: true,
    },
    "seedance2.5 coke": {
        provider: "seedance_video",
        resolutions: ["720"],
        aspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
        maxImages: 30,
        maxVideos: 10,
        maxAudios: 10,
        minDuration: 1,
        maxDuration: 15,
        defaultDuration: 5,
        supportsGenerateAudio: false,
    },
};

export function getVideoModelProfile(model: string, provider?: VideoModelProvider): VideoModelProfile {
    const value = String(model || "").trim().toLowerCase();
    const exact = PROFILES[value];
    if (exact) return provider ? { ...exact, provider } : exact;
    if (/^minimax[\s_-]*h3-self\b/.test(value)) return PROFILES["minimax h3-self"];
    if (/^minimax[\s_-]*h3(?:$|[^0-9])/.test(value)) return PROFILES["minimax h3"];
    if (value.includes("muse") && value.includes("cheap")) return PROFILES["muse-cheap"];
    if (value.includes("muse")) return PROFILES["muse-video"];
    if (value.includes("grok-imagine-video-1.5")) return PROFILES["grok-imagine-video-1.5"];
    if (value.includes("grok-imagine-video")) return PROFILES["grok-imagine-video"];
    if (value.includes("seedance-2.0-fast")) return PROFILES["seedance-2.0-fast"];
    if (value.includes("seedance-2.0")) return PROFILES["seedance-2.0"];
    if (value.includes("seedance-2.5")) return PROFILES["seedance-2.5"];
    if (value.includes("wan3.0-yuanlian")) return PROFILES["wan3.0-yuanlian"];
    if (value.includes("wan3.0-video")) return PROFILES["wan3.0-video"];
    return provider ? { ...DEFAULT_PROFILE, provider } : DEFAULT_PROFILE;
}

export function resolveVideoModelProvider(
    model: string,
    config: { baseUrl?: string; apiFormat?: string; channelPlatform?: string },
): VideoModelProvider {
    const value = String(model || "").trim().toLowerCase();
    const profile = getVideoModelProfile(value);
    if (profile.provider === "muse_video" || profile.provider === "video_tasks") return profile.provider;

    let host = "";
    try {
        host = new URL(config.baseUrl || "").hostname.toLowerCase();
    } catch {
        host = "";
    }
    const platform = String(config.channelPlatform || "").trim().toLowerCase();
    if (value.includes("grok")) {
        return platform === "grok" || host.endsWith("x.ai") ? "grok" : "seedance_video";
    }
    if (host === "momoapi.xin" || host.endsWith(".momoapi.xin") || host === "openpix.cc" || host.endsWith(".openpix.cc")) {
        return "seedance_video";
    }
    if (profile.provider === "seedance_video") {
        if (platform === "composite") return "seedance_video";
        if (host.includes("volces.com") || String(config.baseUrl || "").toLowerCase().includes("/api/v3")) {
            return "seedance";
        }
        if (platform === "openai" && value.includes("seedance")) return "seedance";
    }
    return profile.provider;
}

export function supportsVideoGenerateAudioToggle(profile: VideoModelProfile) {
    return (profile.provider === "seedance" || profile.provider === "seedance_video") && profile.supportsGenerateAudio;
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
