import type { CreateModelPlazaModel } from "@/services/create-account";
import { getVideoModelProfile } from "@/lib/video-model-profile";

export type PlazaVideoPricingRow = {
    key: string;
    resolution: string;
    price: number;
};

export type PlazaVideoReferenceSummary = {
    images: number;
    videos: number;
    audios: number;
};

const VIDEO_MODEL_NAME_PATTERN = /(?:^|[^a-z])(?:video|seedance|muse)(?:[^a-z]|$)|grok-imagine-video|minimax[\s_-]*h3|wan3\.0-(?:video|yuanlian)/i;

export function isPlazaVideoModel(model: CreateModelPlazaModel) {
    const name = String(model.name || "").trim();
    return Boolean(model.video_capabilities) || model.pricing?.billing_mode === "video" || VIDEO_MODEL_NAME_PATTERN.test(name);
}

export function plazaVideoBillingUnit(model: CreateModelPlazaModel): "second" | "request" {
    return model.pricing?.billing_mode === "video" ? "second" : "request";
}

function formatDurationOptions(options: readonly number[]) {
    const values = Array.from(new Set(options.filter((value) => Number.isFinite(value) && value > 0))).sort((a, b) => a - b);
    if (!values.length) return "-";
    const parts: string[] = [];
    for (let index = 0; index < values.length;) {
        let end = index;
        while (end + 1 < values.length && values[end + 1] === values[end] + 1) end += 1;
        if (end - index >= 2) {
            parts.push(`${values[index]}–${values[end]}s`);
        } else {
            for (let valueIndex = index; valueIndex <= end; valueIndex += 1) parts.push(`${values[valueIndex]}s`);
        }
        index = end + 1;
    }
    return parts.join(" / ");
}

export function plazaVideoDurationLabel(model: CreateModelPlazaModel) {
    const profile = getVideoModelProfile(model.name, model.video_capabilities);
    if (profile.durationOptions?.length) return formatDurationOptions(profile.durationOptions);
    return profile.minDuration === profile.maxDuration
        ? `${profile.maxDuration}s`
        : `${profile.minDuration}–${profile.maxDuration}s`;
}

export function plazaVideoPreviewDurations(model: CreateModelPlazaModel) {
    const profile = getVideoModelProfile(model.name, model.video_capabilities);
    if (profile.durationOptions?.length) {
        const values = Array.from(new Set(profile.durationOptions)).sort((a, b) => a - b);
        return values.length > 1 ? [values[0], values[values.length - 1]] : values;
    }
    return Array.from(new Set([profile.minDuration, profile.maxDuration]));
}

export function plazaVideoPricingRows(model: CreateModelPlazaModel): PlazaVideoPricingRow[] {
    const intervals = (model.pricing?.intervals || []).filter((interval) => interval.per_request_price != null);
    if (intervals.length) {
        return intervals.map((interval, index) => ({
            key: `${index}:${interval.tier_label || ""}`,
            resolution: (interval.tier_label || "标准").toLowerCase(),
            price: Number(interval.per_request_price),
        }));
    }
    if (model.pricing?.per_request_price != null) {
        return [{ key: "standard", resolution: "标准", price: Number(model.pricing.per_request_price) }];
    }
    return [];
}

export function plazaVideoReferenceSummary(model: CreateModelPlazaModel): PlazaVideoReferenceSummary {
    const profile = getVideoModelProfile(model.name, model.video_capabilities);
    return {
        images: profile.maxImages,
        videos: profile.maxVideos,
        audios: profile.maxAudios,
    };
}

export function plazaVideoCapabilityLabels(model: CreateModelPlazaModel) {
    const profile = getVideoModelProfile(model.name, model.video_capabilities);
    const labels: string[] = [];
    if (profile.modes.includes("text-to-video")) labels.push("文生视频");
    if (profile.modes.includes("image-to-video")) labels.push("图生视频");
    if (profile.modes.includes("first-last-frame")) labels.push("首尾帧");
    if (profile.modes.includes("reference-images")) labels.push("参考图");
    if (profile.modes.includes("reference-video")) labels.push("参考视频");
    if (profile.modes.includes("video-edit")) labels.push("视频编辑");
    if (profile.modes.includes("video-extension")) labels.push("视频续写");
    if (profile.outputsAudio) labels.push("输出音频");
    return labels;
}

export function plazaVideoModelDescription(model: CreateModelPlazaModel) {
    const profile = getVideoModelProfile(model.name, model.video_capabilities);
    const labels = plazaVideoCapabilityLabels(model);
    const duration = `${profile.minDuration === profile.maxDuration ? profile.maxDuration : `${profile.minDuration}–${profile.maxDuration}`} 秒`;
    const parts = [
        labels.length ? `支持${labels.join("、")}` : "",
        `时长 ${duration}`,
        profile.resolutions.length ? `分辨率 ${profile.resolutions.join(" / ")}` : "",
        profile.maxImages || profile.maxVideos || profile.maxAudios
            ? `参考素材最多 ${profile.maxImages} 张图、${profile.maxVideos} 个视频、${profile.maxAudios} 段音频`
            : "",
    ].filter(Boolean);
    return parts.length ? `${parts.join("；")}。` : "暂无中文简介。";
}

