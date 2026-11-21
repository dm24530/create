import { videoRatioOptions } from "@/lib/media-size";

export type VideoModelProvider = "seedance" | "muse_video" | "grok" | "seedance_video" | "video_tasks" | "openai_video";

export type VideoCapabilitySlots = {
    first_frame: number;
    last_frame: number;
    reference_image: number;
    reference_video: number;
    reference_audio: number;
};

export type VideoCapabilityProfile = {
    protocol: VideoModelProvider | string;
    min_duration: number;
    max_duration: number;
    default_duration: number;
    max_images?: number;
    duration_options?: number[];
    resolutions?: string[];
    aspect_ratios?: string[];
    slots?: Partial<VideoCapabilitySlots>;
    supports_generate_audio?: boolean;
    outputs_audio?: boolean;
    modes?: string[];
    frame_reference_exclusive?: boolean;
    reference_image_free_count?: number;
    reference_image_extra_price?: number;
    reference_video_billing_mode?: "off" | "max_seconds" | "sum_seconds";
};

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
    outputsAudio: boolean;
    slots: VideoCapabilitySlots;
    modes: readonly string[];
};

const ALL_VIDEO_RATIOS = videoRatioOptions.filter((item) => item.value !== "auto").map((item) => item.value);
const EMPTY_SLOTS: VideoCapabilitySlots = {
    first_frame: 0,
    last_frame: 0,
    reference_image: 3,
    reference_video: 0,
    reference_audio: 0,
};
const DEFAULT_PROFILE: VideoModelProfile = {
    provider: "openai_video",
    resolutions: ["480", "720", "1080"],
    aspectRatios: ALL_VIDEO_RATIOS,
    maxImages: 3,
    maxVideos: 0,
    maxAudios: 0,
    minDuration: 1,
    maxDuration: 15,
    defaultDuration: 5,
    supportsGenerateAudio: true,
    outputsAudio: false,
    slots: EMPTY_SLOTS,
    modes: ["text-to-video", "image-to-video", "reference-images"],
};

function normalizeProvider(value: unknown): VideoModelProvider {
    const provider = String(value || "").trim().toLowerCase();
    if (provider === "seedance" || provider === "muse_video" || provider === "grok" || provider === "seedance_video" || provider === "video_tasks" || provider === "openai_video") {
        return provider;
    }
    return "openai_video";
}

function normalizeResolution(value: string) {
    return String(value || "").trim().replace(/p$/i, "");
}

function totalImages(slots: VideoCapabilitySlots) {
    return Math.max(0, slots.first_frame) + Math.max(0, slots.last_frame) + Math.max(0, slots.reference_image);
}

function deriveModes(slots: VideoCapabilitySlots, configured?: string[]) {
    const modes = new Set((configured || []).map((mode) => String(mode || "").trim()).filter(Boolean));
    modes.add("text-to-video");
    if (slots.first_frame > 0) modes.add("image-to-video");
    if (slots.first_frame > 0 && slots.last_frame > 0) modes.add("first-last-frame");
    if (slots.reference_image > 0) modes.add("reference-images");
    if (slots.reference_video > 0) modes.add("reference-video");
    return Array.from(modes);
}

export function profileFromVideoCapability(capability?: VideoCapabilityProfile | null): VideoModelProfile | null {
    if (!capability) return null;
    const rawSlots = capability.slots || {};
    const slots: VideoCapabilitySlots = {
        first_frame: Math.max(0, Number(rawSlots.first_frame) || 0),
        last_frame: Math.max(0, Number(rawSlots.last_frame) || 0),
        reference_image: Math.max(0, Number(rawSlots.reference_image) || 0),
        reference_video: Math.max(0, Number(rawSlots.reference_video) || 0),
        reference_audio: Math.max(0, Number(rawSlots.reference_audio) || 0),
    };
    const minDuration = Math.max(1, Number(capability.min_duration) || 1);
    const maxDuration = Math.max(minDuration, Number(capability.max_duration) || minDuration);
    const defaultDuration = Math.min(maxDuration, Math.max(minDuration, Number(capability.default_duration) || minDuration));
    const resolutions = (capability.resolutions || []).map(normalizeResolution).filter(Boolean);
    const ratios = (capability.aspect_ratios || []).filter(Boolean);
    return {
        provider: normalizeProvider(capability.protocol),
        resolutions: resolutions.length ? Array.from(new Set(resolutions)) : DEFAULT_PROFILE.resolutions,
        aspectRatios: ratios.length ? Array.from(new Set(ratios)) : DEFAULT_PROFILE.aspectRatios,
        maxImages: Math.max(0, Number(capability.max_images) || totalImages(slots)),
        maxVideos: slots.reference_video,
        maxAudios: slots.reference_audio,
        minDuration,
        maxDuration,
        defaultDuration,
        durationOptions: Array.isArray(capability.duration_options) ? capability.duration_options : undefined,
        supportsGenerateAudio: capability.supports_generate_audio === true,
        outputsAudio: capability.outputs_audio === true,
        slots,
        modes: deriveModes(slots, capability.modes),
    };
}

export function getVideoModelProfile(_model: string, capability?: VideoCapabilityProfile | null): VideoModelProfile {
    return profileFromVideoCapability(capability) || DEFAULT_PROFILE;
}

export function supportsVideoGenerateAudioToggle(profile: VideoModelProfile) {
    return profile.supportsGenerateAudio;
}

export function isVideoResolutionSupported(profile: VideoModelProfile, resolution: string) {
    return profile.resolutions.includes(normalizeResolution(resolution));
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
