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
    return model.pricing?.billing_mode === "video" || VIDEO_MODEL_NAME_PATTERN.test(name);
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
    const profile = getVideoModelProfile(model.name);
    if (profile.durationOptions?.length) return formatDurationOptions(profile.durationOptions);
    return profile.minDuration === profile.maxDuration
        ? `${profile.maxDuration}s`
        : `${profile.minDuration}–${profile.maxDuration}s`;
}

export function plazaVideoPreviewDurations(model: CreateModelPlazaModel) {
    const profile = getVideoModelProfile(model.name);
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
    const profile = getVideoModelProfile(model.name);
    return {
        images: profile.maxImages,
        videos: profile.maxVideos,
        audios: profile.maxAudios,
    };
}

export function plazaVideoCapabilityLabels(model: CreateModelPlazaModel) {
    const profile = getVideoModelProfile(model.name);
    const labels = ["文生视频", "图生视频"];
    if (profile.maxImages > 0) labels.push("参考图");
    if (profile.maxVideos > 0) labels.push("参考视频");
    if (profile.maxAudios > 0) labels.push("参考音频");
    if (profile.supportsGenerateAudio) labels.push("输出音频");
    return labels;
}

export function plazaVideoModelDescription(model: CreateModelPlazaModel) {
    const name = String(model.name || "").toLowerCase();
    if (name.includes("muse")) return "Muse 视频模型，适合快速生成短视频并支持参考图输入，可用时长以模型档位为准。";
    if (name.includes("grok")) return "Grok 视频模型，支持文生视频、图生视频和参考素材创作，也可用于已有视频的编辑与续写。";
    if (name.includes("wan3.0")) return "Wan 视频模型，支持较长视频生成及图生视频，部分模型可使用参考图和参考视频。";
    if (name.includes("minimax")) return "MiniMax 视频模型，支持文生视频、图生视频及多参考素材，适合人物和场景一致性创作。";
    if (name.includes("seedance")) return "Seedance 视频模型，适合文生视频、图生视频和多参考素材创作，实际能力由当前分组配置决定。";
    return "通用视频生成模型，分辨率、时长和参考素材上限以工作台实际可用选项为准。";
}

