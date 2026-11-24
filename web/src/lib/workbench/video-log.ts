import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { autoSaveGeneratedFile, readGeneratedFileAsset } from "@/lib/desktop-save";
import { computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { normalizeVideoResolutionValue } from "@/components/video-settings-panel";
import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoRatioSupported, isVideoResolutionSupported, supportsVideoGenerateAudioToggle } from "@/lib/video-model-profile";
import { ensureImagePreview, resolveImageUrl } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { boolConfig, modelOptionName, videoCapabilityOf, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { GeneratedVideo, VideoGenerationLog, VideoGenerationLogConfig } from "@/types/workbench";
import type { VideoGenerationTask } from "@/services/api/video";

export async function readVideoLogs(logStore: LocalForage, ensureMigrated: () => Promise<unknown>) {
    if (typeof window === "undefined") return [];
    try {
        await ensureMigrated();
        const logs: VideoGenerationLog[] = [];
        await logStore.iterate<VideoGenerationLog, void>((value) => {
            logs.push(value);
        });
        const normalized = await Promise.all(logs.map(async (stored) => {
            const log = await normalizeVideoLog(stored);
            if (log.video && (log.video.storageKey !== stored.video?.storageKey || log.video.localPath !== stored.video?.localPath)) {
                await logStore.setItem(log.id, serializeVideoLog(log)).catch(() => undefined);
            }
            return log;
        }));
        return normalized.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

export async function normalizeVideoLog(log: Partial<VideoGenerationLog>): Promise<VideoGenerationLog> {
    const video = await resolveStoredVideoForDisplay(log.video);
    const storedReferences = Array.isArray(log.references) ? log.references : [];
    const storedReferenceVideos = Array.isArray(log.referenceVideos) ? log.referenceVideos : [];
    const storedReferenceAudios = Array.isArray(log.referenceAudios) ? log.referenceAudios : [];
    const references = await Promise.all(storedReferences.map(async (item) => {
        void ensureImagePreview(item.storageKey);
        try {
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        } catch {
            return item;
        }
    }));
    const referenceVideos = await Promise.all(storedReferenceVideos.map(async (item) => {
        try {
            return { ...item, url: await resolveMediaUrl(item.storageKey, item.url) };
        } catch {
            return item;
        }
    }));
    const referenceAudios = await Promise.all(storedReferenceAudios.map(async (item) => {
        try {
            return { ...item, url: await resolveMediaUrl(item.storageKey, item.url) };
        } catch {
            return item;
        }
    }));
    const config = normalizeVideoLogConfig(log);
    return {
        id: log.id || nanoid(),
        userId: log.userId || Number(useUserStore.getState().user?.id) || undefined,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        referenceVideos,
        referenceAudios,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeVideoResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "success",
        task: log.task,
        video,
        error: log.error,
    };
}

export async function recoverVideoFromLocalFile(video: GeneratedVideo): Promise<GeneratedVideo | null> {
    try {
        const recovered = await readGeneratedFileAsset({
            kind: "video",
            path: video.localPath,
            filename: video.localPath?.split(/[\\/]/).pop() || undefined,
            size: video.bytes,
            mimeType: video.mimeType,
        });
        if (!recovered?.blob.size) return null;
        const storageKey = video.storageKey?.trim() || `video:${nanoid()}`;
        let url = "";
        try {
            url = await setMediaBlob(storageKey, recovered.blob);
        } catch {
            url = URL.createObjectURL(recovered.blob);
        }
        return {
            ...video,
            storageKey,
            localPath: recovered.savePath || video.localPath || "",
            url,
            bytes: recovered.blob.size,
            mimeType: recovered.blob.type || video.mimeType || "video/mp4",
        };
    } catch {
        return null;
    }
}

export async function resolveStoredVideoForDisplay(video?: GeneratedVideo): Promise<GeneratedVideo | undefined> {
    if (!video) return undefined;
    let localPath = video.localPath?.trim() || "";
    let url = "";
    if (video.storageKey) url = await resolveMediaUrl(video.storageKey, "").catch(() => "");
    if (!localPath) {
        const savedFile = await readGeneratedFileAsset({
            kind: "video",
            size: video.bytes,
            mimeType: video.mimeType,
        }).catch(() => null);
        if (savedFile?.blob.size) {
            localPath = savedFile.savePath;
            if (!url) {
                const storageKey = video.storageKey || `video:${nanoid()}`;
                url = await setMediaBlob(storageKey, savedFile.blob).catch(() => URL.createObjectURL(savedFile.blob));
                if (!video.storageKey) video = { ...video, storageKey };
            }
        }
    }
    if (url && !localPath && video.storageKey) {
        const blob = await getMediaBlob(video.storageKey).catch(() => null);
        if (blob?.size) {
            const saved = await autoSaveGeneratedFile(blob, "video", video.mimeType || blob.type || "video/mp4").catch(() => null);
            localPath = saved?.savePath || "";
        }
    }
    if (!url) {
        const recovered = await recoverVideoFromLocalFile({ ...video, localPath });
        if (recovered) return recovered;
    }
    const durableFallback = video.url && !video.url.startsWith("blob:") ? video.url : "";
    return { ...video, ...(localPath ? { localPath } : {}), url: url || durableFallback };
}

export function serializeVideoLog(log: VideoGenerationLog): VideoGenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        referenceVideos: log.referenceVideos.map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
        referenceAudios: log.referenceAudios.map((item) => ({ ...item, url: item.storageKey ? "" : item.url })),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

export function normalizeVideoLogConfig(log: Partial<VideoGenerationLog>): VideoGenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeVideoResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoMode: log.config?.videoMode === "reference" ? "reference" : "frames",
    };
}

export function buildVideoLog({
    id,
    prompt,
    model,
    config,
    references,
    referenceVideos,
    referenceAudios,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    id?: string;
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    durationMs: number;
    status: VideoGenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): VideoGenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeVideoResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoMode: config.videoMode === "reference" ? "reference" as const : "frames" as const,
    };
    return {
        id: id || nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        referenceVideos,
        referenceAudios,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

export function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const profile = getVideoModelProfile(modelOptionName(model), videoCapabilityOf(config, model));
    const requestedResolution = normalizeVideoResolution(config.vquality);
    const resolution = isVideoResolutionSupported(profile, requestedResolution) ? requestedResolution : profile.resolutions[0] || "720";
    const requestedRatio = inferVideoRatio(config.size);
    const ratio = isVideoRatioSupported(profile, requestedRatio) ? requestedRatio : profile.aspectRatios[0] || "16:9";
    return {
        ...config,
        model,
        videoModel: model,
        size: computeVideoSize(resolution, ratio),
        videoSeconds: clampVideoSecondsForProfile(config.videoSeconds, profile),
        vquality: resolution,
        videoGenerateAudio: supportsVideoGenerateAudioToggle(profile) ? String(boolConfig(config.videoGenerateAudio, true)) : "false",
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

export function normalizeVideoResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}