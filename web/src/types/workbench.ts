import type { VideoGenerationTask } from "@/services/api/video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    localPath?: string;
    prompt?: string;
    model?: string;
    prepareDurationMs?: number;
    generationDurationMs?: number;
};

export type ImageGenerationResult = {
    id: string;
    logId?: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
    prompt?: string;
    model?: string;
    config?: AiConfig;
    references?: ReferenceImage[];
    phase?: "compressing" | "generating";
    phaseStartedAt?: number;
    prepareDurationMs?: number;
    clientRequestId?: string;
};

export type ImageGenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

export type ImageGenerationLog = {
    id: string;
    userId?: number;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: ImageGenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "success" | "failed";
    images: GeneratedImage[];
    error?: string;
};

export type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    localPath?: string;
    prompt?: string;
    model?: string;
};

export type VideoRequestSnapshot = {
    text: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
};

export type VideoGenerationResult = {
    id: string;
    logId?: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
    prompt?: string;
    model?: string;
    config?: AiConfig;
    references?: ReferenceImage[];
    referenceVideos?: ReferenceVideo[];
    referenceAudios?: ReferenceAudio[];
};

export type VideoGenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoDurationAuto" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;

export type VideoGenerationLog = {
    id: string;
    userId?: number;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: VideoGenerationLogConfig;
    references: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};
