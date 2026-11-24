import { normalizeVideoRatioValue, normalizeVideoResolutionToken } from "@/lib/media-size";

export type VideoModelProvider = "seedance" | "muse_video" | "grok" | "seedance_video" | "video_tasks" | "openai_video" | (string & {});

export type VideoMediaRole =
    | "first_frame"
    | "last_frame"
    | "image"
    | "reference_images"
    | "reference_videos"
    | "reference_audio"
    | "edit_video"
    | "extension_video"
    | "keyframes";

export type VideoMediaFieldSpec = string | { field: string; multiple?: boolean };

export type VideoModeMediaPolicy = {
    image_role: VideoMediaRole;
    video_role: VideoMediaRole;
    audio_role: VideoMediaRole;
    max_images: number;
    max_videos: number;
    max_audios: number;
};

export type VideoRequestSchema = {
    create_path?: string;
    task_path?: string;
    content_path?: string;
    media_fields?: Partial<Record<VideoMediaRole, VideoMediaFieldSpec>>;
    mode_media?: Record<string, Partial<VideoModeMediaPolicy>>;
};

export type VideoModeCapability = {
    duration_options?: number[] | null;
    duration_min_seconds?: number;
    duration_max_seconds?: number;
    duration_default_seconds?: number;
    duration_step_seconds?: number;
    resolution_options?: string[] | null;
};

export type VideoCapabilitySlots = {
    first_frame: number;
    last_frame: number;
    reference_image: number;
    reference_video: number;
    reference_audio: number;
    keyframes: number;
};

export type VideoFileLimits = {
    imageBytes: number;
    videoBytes: number;
    audioBytes: number;
    totalBytes: number;
};

export type VideoParameterOption = string | number | boolean | { value: string | number | boolean; label?: string };

export type VideoParameterSpec = {
    key: string;
    label?: string;
    description?: string;
    type: "boolean" | "integer" | "number" | "string" | "enum";
    default?: string | number | boolean;
    min?: number;
    max?: number;
    step?: number;
    required?: boolean;
    options?: VideoParameterOption[];
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
    file_limits?: Partial<Record<"image_bytes" | "video_bytes" | "audio_bytes" | "total_bytes", number>>;
    parameters?: VideoParameterSpec[];
    request_schema?: VideoRequestSchema;
    mode_capabilities?: Record<string, VideoModeCapability | null>;
};

export type VideoModelProfile = {
    provider: VideoModelProvider;
    resolutions: readonly string[];
    aspectRatios: readonly string[];
    supportsAdaptiveRatio: boolean;
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
    frameReferenceExclusive: boolean;
    referenceImageFreeCount: number;
    referenceImageExtraPrice: number;
    referenceVideoBillingMode: "off" | "max_seconds" | "sum_seconds";
    fileLimits: VideoFileLimits;
    parameters: readonly VideoParameterSpec[];
    requestSchema: VideoRequestSchema;
    modeCapabilities: Readonly<Record<string, VideoModeCapability>>;
};

export const DEFAULT_VIDEO_FILE_LIMITS: VideoFileLimits = {
    imageBytes: 30 * 1024 * 1024,
    videoBytes: 200 * 1024 * 1024,
    audioBytes: 15 * 1024 * 1024,
    totalBytes: 0,
};

export const VIDEO_MODE_VALUES = [
    "text-to-video",
    "image-to-video",
    "first-last-frame",
    "reference-images",
    "reference-video",
    "video-edit",
    "video-extension",
    "keyframes",
] as const;

export const VIDEO_RESOLUTION_VALUES = ["480", "720", "1080", "4k"] as const;
export const VIDEO_DURATION_VALUES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30] as const;

const EMPTY_SLOTS: VideoCapabilitySlots = {
    first_frame: 0,
    last_frame: 0,
    reference_image: 3,
    reference_video: 0,
    reference_audio: 0,
    keyframes: 0,
};
const DEFAULT_PROFILE: VideoModelProfile = {
    provider: "openai_video",
    resolutions: ["480", "720", "1080"],
    aspectRatios: ["16:9"],
    supportsAdaptiveRatio: false,
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
    frameReferenceExclusive: false,
    referenceImageFreeCount: 0,
    referenceImageExtraPrice: 0,
    referenceVideoBillingMode: "off",
    fileLimits: DEFAULT_VIDEO_FILE_LIMITS,
    parameters: [],
    requestSchema: {},
    modeCapabilities: {},
};

function normalizeProvider(value: unknown): VideoModelProvider {
    const provider = String(value || "").trim().toLowerCase();
    if (!provider) return "openai_video";
    if (provider === "openai") return "openai_video";
    return provider;
}

function normalizeRequestSchema(schema?: VideoRequestSchema | null): VideoRequestSchema {
    if (!schema || typeof schema !== "object") return {};
    const path = (value: unknown) => {
        const pathValue = String(value || "").trim();
        return pathValue || undefined;
    };
    const mediaFields: Record<string, VideoMediaFieldSpec> = {};
    for (const [role, value] of Object.entries(schema.media_fields || {})) {
        if (!value) continue;
        if (typeof value === "string") {
            const field = value.trim();
            if (field) mediaFields[role] = field;
            continue;
        }
        if (typeof value !== "object") continue;
        const field = String(value.field || "").trim();
        if (field) mediaFields[role] = { field, ...(value.multiple === undefined ? {} : { multiple: value.multiple === true }) };
    }
    const modeMedia: Record<string, Partial<VideoModeMediaPolicy>> = {};
    for (const [mode, value] of Object.entries(schema.mode_media || {})) {
        if (!value || typeof value !== "object") continue;
        const normalized: Partial<VideoModeMediaPolicy> = {};
        if (typeof value.image_role === "string" && value.image_role.trim()) normalized.image_role = value.image_role.trim() as VideoMediaRole;
        if (typeof value.video_role === "string" && value.video_role.trim()) normalized.video_role = value.video_role.trim() as VideoMediaRole;
        if (typeof value.audio_role === "string" && value.audio_role.trim()) normalized.audio_role = value.audio_role.trim() as VideoMediaRole;
        for (const key of ["max_images", "max_videos", "max_audios"] as const) {
            const numeric = Number(value[key]);
            if (Number.isFinite(numeric)) normalized[key] = Math.max(0, numeric);
        }
        if (Object.keys(normalized).length) modeMedia[mode] = normalized;
    }
    return {
        create_path: path(schema.create_path),
        task_path: path(schema.task_path),
        content_path: path(schema.content_path),
        media_fields: Object.keys(mediaFields).length ? mediaFields as VideoRequestSchema["media_fields"] : undefined,
        mode_media: Object.keys(modeMedia).length ? modeMedia : undefined,
    };
}

function totalImages(slots: VideoCapabilitySlots) {
    return Math.max(0, slots.first_frame) + Math.max(0, slots.last_frame) + Math.max(0, slots.reference_image);
}

function deriveModes(slots: VideoCapabilitySlots, configured?: string[]) {
    const explicit = Array.from(new Set((configured || []).map((mode) => String(mode || "").trim()).filter(Boolean)));
    if (explicit.length) return explicit;
    const modes = new Set<string>(["text-to-video"]);
    if (slots.first_frame > 0) modes.add("image-to-video");
    if (slots.first_frame > 0 && slots.last_frame > 0) modes.add("first-last-frame");
    if (slots.reference_image > 0) modes.add("reference-images");
    if (slots.reference_video > 0) modes.add("reference-video");
    return Array.from(modes);
}

export function normalizeVideoFileLimits(input?: VideoCapabilityProfile["file_limits"] | null): VideoFileLimits {
    const positiveOr = (value: unknown, fallback: number) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
    };
    const nonNegative = (value: unknown) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    };
    return {
        imageBytes: positiveOr(input?.image_bytes, DEFAULT_VIDEO_FILE_LIMITS.imageBytes),
        videoBytes: positiveOr(input?.video_bytes, DEFAULT_VIDEO_FILE_LIMITS.videoBytes),
        audioBytes: positiveOr(input?.audio_bytes, DEFAULT_VIDEO_FILE_LIMITS.audioBytes),
        totalBytes: nonNegative(input?.total_bytes),
    };
}

function normalizeParameters(parameters?: VideoParameterSpec[]) {
    if (!Array.isArray(parameters)) return [];
    const seen = new Set<string>();
    return parameters.flatMap((parameter) => {
        if (!parameter || typeof parameter !== "object") return [];
        const key = String(parameter.key || "").trim();
        const type = parameter.type;
        if (!key || seen.has(key) || !["boolean", "integer", "number", "string", "enum"].includes(type)) return [];
        seen.add(key);
        return [{
            ...parameter,
            key,
            label: parameter.label?.trim() || key,
            description: parameter.description?.trim() || undefined,
            options: Array.isArray(parameter.options) ? parameter.options : undefined,
        }];
    });
}

function normalizeModeCapabilities(input?: Record<string, VideoModeCapability | null> | null): Record<string, VideoModeCapability> {
    const result: Record<string, VideoModeCapability> = {};
    for (const [rawMode, raw] of Object.entries(input || {})) {
        const mode = String(rawMode || "").trim();
        if (!mode || !raw || typeof raw !== "object") continue;
        const normalized: VideoModeCapability = {};
        if (Array.isArray(raw.duration_options)) {
            normalized.duration_options = Array.from(new Set(raw.duration_options.map((value) => Math.trunc(Number(value))).filter((value) => Number.isFinite(value) && value > 0))).sort((left, right) => left - right);
        }
        if (Array.isArray(raw.resolution_options)) {
            normalized.resolution_options = Array.from(new Set(raw.resolution_options.map((value) => normalizeVideoResolutionToken(value)).filter(Boolean)));
        }
        for (const key of ["duration_min_seconds", "duration_max_seconds", "duration_default_seconds", "duration_step_seconds"] as const) {
            const value = Number(raw[key]);
            if (Number.isFinite(value) && value > 0) normalized[key] = value;
        }
        result[mode] = normalized;
    }
    return result;
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
        keyframes: Math.max(0, Number(rawSlots.keyframes) || 0),
    };
    const minDuration = Math.max(1, Number(capability.min_duration) || 1);
    const maxDuration = Math.max(minDuration, Number(capability.max_duration) || minDuration);
    const defaultDuration = Math.min(maxDuration, Math.max(minDuration, Number(capability.default_duration) || minDuration));
    const rawResolutions = capability.resolutions || [];
    const resolutions = Array.from(new Set(rawResolutions.map((value) => normalizeVideoResolutionToken(value)).filter(Boolean)));
    const rawRatios = capability.aspect_ratios || [];
    const ratios = Array.from(new Set(rawRatios.map((value) => normalizeVideoRatioValue(value)).filter(Boolean)));
    const supportsAdaptiveRatio = rawRatios.some((value) => String(value || "").trim().toLowerCase() === "adaptive");
    return {
        provider: normalizeProvider(capability.protocol),
        resolutions: resolutions.length ? resolutions : DEFAULT_PROFILE.resolutions,
        aspectRatios: ratios.length ? ratios : DEFAULT_PROFILE.aspectRatios,
        supportsAdaptiveRatio,
        maxImages: Math.max(Math.max(0, Number(capability.max_images) || totalImages(slots)), slots.keyframes),
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
        frameReferenceExclusive: capability.frame_reference_exclusive === true,
        referenceImageFreeCount: Math.max(0, Number(capability.reference_image_free_count) || 0),
        referenceImageExtraPrice: Math.max(0, Number(capability.reference_image_extra_price) || 0),
        referenceVideoBillingMode: capability.reference_video_billing_mode === "max_seconds" || capability.reference_video_billing_mode === "sum_seconds"
            ? capability.reference_video_billing_mode
            : "off",
        fileLimits: normalizeVideoFileLimits(capability.file_limits),
        parameters: normalizeParameters(capability.parameters),
        requestSchema: normalizeRequestSchema(capability.request_schema),
        modeCapabilities: normalizeModeCapabilities(capability.mode_capabilities),
    };
}

export function getVideoModelProfile(_model: string, capability?: VideoCapabilityProfile | null): VideoModelProfile {
    return profileFromVideoCapability(capability) || DEFAULT_PROFILE;
}

/**
 * Applies capability details that the upstream declares for one generation
 * mode. Model-wide values remain the fallback when a mode does not override
 * them, keeping older capability rows compatible.
 */
export function resolveVideoModeProfile(profile: VideoModelProfile, mode: string): VideoModelProfile {
    const capability = profile.modeCapabilities[String(mode || "").trim()];
    if (!capability) return profile;
    const minDuration = Math.max(1, Number(capability.duration_min_seconds) || profile.minDuration);
    const maxDuration = Math.max(minDuration, Number(capability.duration_max_seconds) || profile.maxDuration);
    const defaultDuration = Math.min(maxDuration, Math.max(minDuration, Number(capability.duration_default_seconds) || profile.defaultDuration));
    return {
        ...profile,
        resolutions: capability.resolution_options?.length ? capability.resolution_options : profile.resolutions,
        minDuration,
        maxDuration,
        defaultDuration,
        durationOptions: capability.duration_options != null ? capability.duration_options : profile.durationOptions,
    };
}

/** Every button the UI knows about stays visible; unsupported ones are disabled by callers. */
export function videoResolutionAlias(profile: VideoModelProfile, resolution: string) {
    const normalized = normalizeVideoResolutionToken(resolution);
    if (profile.resolutions.includes(normalized)) return normalized;
    if (normalized === "720" && profile.resolutions.includes("768")) return "768";
    if (normalized === "768" && profile.resolutions.includes("720")) return "720";
    return normalized;
}

/** Resolve a UI tier to the concrete upstream token when the model uses 768p as its 720p tier. */
export function resolveVideoResolutionForProfile(profile: VideoModelProfile, resolution: string) {
    return videoResolutionAlias(profile, resolution);
}

export function videoResolutionChoices(profile: VideoModelProfile, mode?: string) {
    const modeProfile = mode ? resolveVideoModeProfile(profile, mode) : profile;
    const values = new Set<string>(VIDEO_RESOLUTION_VALUES);
    for (const resolution of [...profile.resolutions, ...modeProfile.resolutions]) {
        const normalized = normalizeVideoResolutionToken(resolution);
        values.add(normalized === "768" ? "720" : normalized);
    }
    return Array.from(values).sort((left, right) => Number(normalizeVideoResolutionToken(left).replace("k", "000")) - Number(normalizeVideoResolutionToken(right).replace("k", "000")));
}

/** Includes future upstream modes while keeping a stable order for known modes. */
export function videoModeChoices(profile: VideoModelProfile) {
    return Array.from(new Set([...VIDEO_MODE_VALUES, ...profile.modes]));
}

/** Candidate duration buttons. Availability is checked separately per mode. */
export function videoDurationChoices(profile: VideoModelProfile) {
    return Array.from(new Set([...VIDEO_DURATION_VALUES, ...(profile.durationOptions || [])])).sort((left, right) => left - right);
}

export function isVideoModeSupported(profile: VideoModelProfile, mode: string) {
    return profile.modes.includes(mode);
}

export function normalizeVideoModeValue(value: unknown, profile?: Pick<VideoModelProfile, "modes">): string {
    const raw = String(value || "").trim();
    if (!raw || raw === "auto") return "auto";
    if (profile && profile.modes.includes(raw)) return raw;
    if (raw === "frames") {
        if (profile?.modes.includes("image-to-video")) return "image-to-video";
        if (profile?.modes.includes("first-last-frame")) return "first-last-frame";
        if (profile?.modes.includes("reference-images")) return "reference-images";
        return "auto";
    }
    if (raw === "reference") {
        if (profile?.modes.includes("reference-images")) return "reference-images";
        if (profile?.modes.includes("reference-video")) return "reference-video";
        return "auto";
    }
    return profile ? "auto" : raw;
}

export function resolveVideoModeForMedia(
    profile: VideoModelProfile,
    preferredMode: unknown,
    media: { imageCount: number; videoCount: number; audioCount: number },
) {
    const rawPreferred = String(preferredMode || "").trim();
    if (rawPreferred === "reference" && media.videoCount > 0 && profile.modes.includes("reference-video")) return "reference-video";
    const preferred = normalizeVideoModeValue(preferredMode, profile);
    if (preferred !== "auto") return preferred;
    if (media.videoCount > 0 && profile.modes.includes("reference-video")) return "reference-video";
    if (media.imageCount > 0 && profile.modes.includes("reference-images")) return "reference-images";
    if (media.imageCount === 1 && profile.modes.includes("image-to-video")) return "image-to-video";
    if (media.imageCount > 1 && profile.modes.includes("first-last-frame")) return "first-last-frame";
    if (media.imageCount > 0 && profile.modes.includes("image-to-video") && media.imageCount <= Math.max(1, profile.slots.first_frame)) return "image-to-video";
    if ((media.imageCount > 0 || media.audioCount > 0) && profile.modes.includes("reference-images")) return "reference-images";
    return profile.modes.includes("text-to-video") ? "text-to-video" : profile.modes[0] || "auto";
}

export type VideoReferencePlan = {
    imageRoles: readonly string[];
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

/**
 * Resolves the workbench mode from the user's chosen media purpose. The last
 * explicit mode is respected only when its required media still exists; every
 * other case falls back to the simplest mode the model supports.
 */
export function resolveVideoModeForReferencePlan(profile: VideoModelProfile, requestedMode: string, plan: VideoReferencePlan): string {
    const explicit = normalizeVideoModeValue(requestedMode, profile);
    const can = (mode: string) => profile.modes.includes(mode);
    const hasFirst = plan.imageRoles.includes("first_frame");
    const hasLast = plan.imageRoles.includes("last_frame");
    const hasKeyframes = plan.imageRoles.includes("keyframe");
    if (explicit === "keyframes" && hasKeyframes && can("keyframes")) return "keyframes";
    if (explicit === "first-last-frame" && hasFirst && hasLast && can("first-last-frame")) return "first-last-frame";
    if (explicit === "image-to-video" && hasFirst && can("image-to-video")) return "image-to-video";
    if (explicit === "reference-images" && (plan.imageCount > 0 || plan.audioCount > 0) && can("reference-images")) return "reference-images";
    if (explicit === "reference-video" && plan.videoCount > 0 && can("reference-video")) return "reference-video";
    if (explicit === "video-edit" && plan.videoCount > 0 && can("video-edit")) return "video-edit";
    if (explicit === "video-extension" && plan.videoCount > 0 && can("video-extension")) return "video-extension";

    if (hasKeyframes && can("keyframes")) return "keyframes";
    if (hasFirst && hasLast && can("first-last-frame")) return "first-last-frame";
    if (hasFirst) return can("image-to-video") ? "image-to-video" : can("first-last-frame") ? "first-last-frame" : "text-to-video";
    if (plan.videoCount > 0) return can("reference-video") ? "reference-video" : can("video-edit") ? "video-edit" : can("video-extension") ? "video-extension" : "text-to-video";
    if (plan.imageCount > 0 || plan.audioCount > 0) return can("reference-images") ? "reference-images" : "text-to-video";
    return can("text-to-video") ? "text-to-video" : profile.modes[0] || "text-to-video";
}

export function resolveVideoModeMediaPolicy(profile: VideoModelProfile, mode: string): VideoModeMediaPolicy {
    // Momo's edit/extension contract only accepts the source video.
    const editReferenceImages = profile.provider === "momo_video" ? 0 : profile.slots.reference_image;
    const editReferenceAudios = profile.provider === "momo_video" ? 0 : profile.slots.reference_audio;
    const defaults: VideoModeMediaPolicy = mode === "text-to-video"
        ? { image_role: "reference_images", video_role: "reference_videos", audio_role: "reference_audio", max_images: 0, max_videos: 0, max_audios: 0 }
        : mode === "image-to-video"
            ? { image_role: "image", video_role: "reference_videos", audio_role: "reference_audio", max_images: Math.min(1, profile.maxImages), max_videos: 0, max_audios: 0 }
            : mode === "first-last-frame"
                ? { image_role: "first_frame", video_role: "reference_videos", audio_role: "reference_audio", max_images: Math.min(2, Math.max(0, profile.slots.first_frame) + Math.max(0, profile.slots.last_frame)), max_videos: 0, max_audios: 0 }
                : mode === "reference-images"
                    ? { image_role: "reference_images", video_role: "reference_videos", audio_role: "reference_audio", max_images: profile.slots.reference_image, max_videos: 0, max_audios: profile.slots.reference_audio }
                    : mode === "reference-video"
                        ? { image_role: "reference_images", video_role: "reference_videos", audio_role: "reference_audio", max_images: profile.slots.reference_image, max_videos: profile.slots.reference_video, max_audios: profile.slots.reference_audio }
                        : mode === "video-edit"
                            ? { image_role: "reference_images", video_role: "edit_video", audio_role: "reference_audio", max_images: editReferenceImages, max_videos: 1, max_audios: editReferenceAudios }
                            : mode === "video-extension"
                                ? { image_role: "reference_images", video_role: "extension_video", audio_role: "reference_audio", max_images: editReferenceImages, max_videos: 1, max_audios: editReferenceAudios }
                                : mode === "keyframes"
                                    ? { image_role: "keyframes", video_role: "reference_videos", audio_role: "reference_audio", max_images: profile.slots.keyframes, max_videos: 0, max_audios: 0 }
                                    : { image_role: "reference_images", video_role: "reference_videos", audio_role: "reference_audio", max_images: profile.slots.reference_image, max_videos: profile.slots.reference_video, max_audios: profile.slots.reference_audio };
    return { ...defaults, ...(profile.requestSchema.mode_media?.[mode] || {}) };
}

export function normalizeVideoParameterValue(parameter: VideoParameterSpec, value: unknown) {
    const clampNumber = (numeric: number) => {
        const bounded = Math.min(parameter.max ?? numeric, Math.max(parameter.min ?? numeric, numeric));
        return parameter.type === "integer" ? Math.trunc(bounded) : bounded;
    };
    if (parameter.type === "boolean") {
        if (typeof value === "boolean") return value;
        if (value === "true" || value === 1 || value === "1") return true;
        if (value === "false" || value === 0 || value === "0") return false;
        return typeof parameter.default === "boolean" ? parameter.default : false;
    }
    if (parameter.type === "integer" || parameter.type === "number") {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? clampNumber(numeric) : parameter.default;
    }
    if (parameter.type === "enum") {
        const options = (parameter.options || []).map((option) => typeof option === "object" ? option.value : option);
        if (options.includes(value as string | number | boolean)) return value;
        if (options.includes(parameter.default as string | number | boolean)) return parameter.default;
        return options[0] ?? parameter.default;
    }
    if (value === undefined || value === null) return parameter.default;
    return String(value);
}

export function resolveVideoParameterValues(profile: VideoModelProfile, values: Record<string, unknown> = {}) {
    const result: Record<string, unknown> = {};
    for (const parameter of profile.parameters) {
        if (Object.prototype.hasOwnProperty.call(values, parameter.key)) result[parameter.key] = normalizeVideoParameterValue(parameter, values[parameter.key]);
        else if (parameter.default !== undefined) result[parameter.key] = normalizeVideoParameterValue(parameter, parameter.default);
    }
    return result;
}

export function supportsVideoGenerateAudioToggle(profile: VideoModelProfile) {
    return profile.supportsGenerateAudio;
}

export function isVideoResolutionSupported(profile: VideoModelProfile, resolution: string, mode?: string) {
    const target = mode ? resolveVideoModeProfile(profile, mode) : profile;
    return target.resolutions.includes(videoResolutionAlias(target, resolution));
}

export function isVideoRatioSupported(profile: VideoModelProfile, ratio: string) {
    return profile.aspectRatios.includes(normalizeVideoRatioValue(ratio));
}

export function isVideoDurationOptionAllowed(profile: VideoModelProfile, seconds: number, mode?: string) {
    const target = mode ? resolveVideoModeProfile(profile, mode) : profile;
    if (!Number.isFinite(seconds) || seconds < target.minDuration || seconds > target.maxDuration) return false;
    return !target.durationOptions?.length || target.durationOptions.includes(seconds);
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