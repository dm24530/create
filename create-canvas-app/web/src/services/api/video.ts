import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { createRequest } from "@/services/create-api";
import { useUserStore } from "@/stores/use-user-store";
import { prepareImageRequestDataUrls } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, videoCapabilityOf, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { clampVideoSecondsForProfile, getVideoModelProfile, type VideoModelProfile, type VideoModelProvider } from "@/lib/video-model-profile";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id: string; request_id?: string; task_id?: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "plugin"; model: string };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

export class VideoPollingError extends Error {
    status: number;

    constructor(message: string, status = 0) {
        super(message);
        this.name = "VideoPollingError";
        this.status = status;
    }
}

export function isRetryableVideoPollingError(error: unknown) {
    if (error instanceof VideoPollingError) {
        return error.status === 0 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
    }
    return true;
}

export type VideoProviderRequestInput = {
    model: string;
    prompt: string;
    durationSeconds: number;
    durationAuto?: boolean;
    resolution: string;
    aspectRatio: string;
    generateAudio: boolean;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
    imageMode: "frames" | "reference";
};

export function buildVideoProviderRequest(provider: VideoModelProvider, input: VideoProviderRequestInput, profile?: VideoModelProfile): { path: string; body: Record<string, unknown> } {
    if (provider === "seedance") {
        const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
        input.imageUrls.forEach((url, index) => {
            const role = input.imageMode === "frames" ? (index === 0 ? "first_frame" : "last_frame") : "reference_image";
            content.push({ type: "image_url", image_url: { url }, role });
        });
        input.videoUrls.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
        input.audioUrls.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
        const body: Record<string, unknown> = {
            model: input.model,
            content,
            resolution: normalizeVideoResolution(input.resolution),
            ratio: input.aspectRatio,
            generate_audio: input.generateAudio,
        };
        if (!input.durationAuto) body.duration = input.durationSeconds;
        return { path: "/contents/generations/tasks", body };
    }

    if (provider === "openai_video") {
        const body: Record<string, unknown> = {
            model: input.model,
            prompt: input.prompt,
            resolution: normalizeVideoResolution(input.resolution),
            aspect_ratio: input.aspectRatio,
            generate_audio: input.generateAudio,
        };
        if (!input.durationAuto) {
            body.seconds = input.durationSeconds;
            body.duration = input.durationSeconds;
        }
        if (input.imageUrls[0]) body.image = { url: input.imageUrls[0] };
        if (input.videoUrls[0]) body.video = { url: input.videoUrls[0] };
        return { path: "/videos", body };
    }

    const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        resolution: normalizeVideoResolution(input.resolution),
        aspect_ratio: input.aspectRatio,
    };
    if (!input.durationAuto) body.duration = input.durationSeconds;
    if (profile?.supportsGenerateAudio) body.generate_audio = input.generateAudio;

    const sendMode = provider === "seedance_video" || provider === "grok";
    const supportsFrames = profile?.modes.includes("image-to-video") ?? input.imageMode === "frames";
    const useFrames = input.imageMode === "frames" && supportsFrames && !input.videoUrls.length;
    if (input.videoUrls.length) {
        if (sendMode) body.mode = "reference-video";
        body.reference_video_urls = input.videoUrls;
        if (input.imageUrls.length) body.reference_image_urls = input.imageUrls;
        if (input.audioUrls.length) body.reference_audio_urls = input.audioUrls;
    } else if (useFrames && input.imageUrls.length) {
        if (input.imageUrls.length > 1) {
            body.mode = "first-last-frame";
            body.first_frame_image_url = input.imageUrls[0];
            body.last_frame_image_url = input.imageUrls[1];
        } else if (provider === "seedance_video") {
            body.mode = "image-to-video";
            body.images = [input.imageUrls[0]];
        } else {
            body.mode = "image-to-video";
            body.first_frame_image_url = input.imageUrls[0];
        }
        if (input.audioUrls.length) body.reference_audio_urls = input.audioUrls;
    } else if (input.imageUrls.length || input.audioUrls.length) {
        if (sendMode) body.mode = "reference-images";
        if (input.imageUrls.length) body.reference_image_urls = input.imageUrls;
        if (input.audioUrls.length) body.reference_audio_urls = input.audioUrls;
    } else if (sendMode) {
        body.mode = "text-to-video";
    }
    return { path: "/video/generations", body };
}

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

const VIDEO_GENERATION_TIMEOUT_MS = 45 * 60_000;

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    const deadline = Date.now() + VIDEO_GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        await delay(Math.min(2500, Math.max(0, deadline - Date.now())), options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createVendorVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = (await prepareImageRequestDataUrls(references, options)).map((image) => image.dataUrl);
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSecondsForModel(config.videoSeconds, model, config),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length, getVideoModelProfile(modelOptionName(model), videoCapabilityOf(config, model))),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        return uploadMediaFile(result.url, "video");
    }
    throw new Error(apiText("noPlayableVideo"));
}

async function createVendorVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const profile = getVideoModelProfile(modelOptionName(model), videoCapabilityOf(config, model));
    const provider = profile.provider;
    const preparedImages = await prepareImageRequestDataUrls(references, options);
    const imageUrls = await Promise.all(preparedImages.map((image) => (
        image.dataUrl.startsWith("data:") ? uploadVideoReferenceAsset("image", image.dataUrl) : image.dataUrl
    )));
    const acceptsVideo = profile.maxVideos > 0;
    const acceptsAudio = profile.maxAudios > 0;
    const videoUrls = acceptsVideo
        ? await Promise.all((options?.videos || []).map(async (video) => uploadVideoReferenceAsset("video", await readFileAsDataUrl(await referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)))))
        : [];
    const audioUrls = acceptsAudio
        ? await Promise.all((options?.audios || []).map(async (audio) => uploadVideoReferenceAsset("audio", await readFileAsDataUrl(await referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)))))
        : [];
    const request = buildVideoProviderRequest(provider, {
        model: modelOptionName(model),
        prompt,
        durationSeconds: Number(clampVideoSecondsForProfile(config.videoSeconds, profile)) || profile.defaultDuration,
        durationAuto: config.videoDurationAuto === true,
        resolution: normalizeVideoResolution(config.vquality),
        aspectRatio: videoAspectRatio(config.size),
        generateAudio: boolConfig(config.videoGenerateAudio, true),
        imageUrls,
        videoUrls,
        audioUrls,
        imageMode: resolveVideoMode(config.videoMode, imageUrls.length, profile),
    }, profile);
    return createJsonVideoTask(config, request.path, request.body, model, options);
}

async function uploadVideoReferenceAsset(kind: "image" | "video" | "audio", dataUrl: string) {
    const session = useUserStore.getState().session;
    if (!session) throw new Error("登录会话已失效，请重新登录");
    const result = await createRequest<{ url: string }>("/video-studio/reference-assets", {
        method: "POST",
        accessToken: session.accessToken,
        body: JSON.stringify({ kind, data_url: dataUrl }),
    });
    const url = String(result?.url || "").trim();
    if (!url) throw new Error("参考素材上传后没有返回可用地址");
    return url;
}

async function createJsonVideoTask(config: AiConfig, path: string, body: Record<string, unknown>, model: string, options?: RequestOptions): Promise<VideoGenerationTask> {
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, path), body, {
            headers: aiHeaders(config, "application/json"),
            signal: options?.signal,
            timeout: 60_000,
        })).data);
        const taskId = String(created.id || created.request_id || created.task_id || "").trim();
        if (!taskId) throw new Error(apiText("noVideoTaskId"));
        return { id: taskId, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const model = modelOptionName(task.model);
    const provider = getVideoModelProfile(model, videoCapabilityOf(config, task.model)).provider;
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, videoTaskPath(provider, task.id, model)), { headers: aiHeaders(config), signal: options?.signal, timeout: 30_000 })).data);
        if (isCompletedVideoStatus(video.status)) {
            const content = await axios.get<Blob>(aiApiUrl(config, videoContentPath(provider, task.id, model)), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal, timeout: 120_000 });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (isFailedVideoStatus(video.status)) return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new VideoPollingError(readAxiosError(error, apiText("videoTaskQueryFailed")), axios.isAxiosError(error) ? error.response?.status || 0 : 0);
    }
}

export function videoTaskPath(provider: VideoModelProvider, requestId: string, model: string) {
    const id = encodeURIComponent(requestId);
    if (provider === "seedance") return `/contents/generations/tasks/${id}`;
    if (provider === "grok") return `/videos/${id}`;
    return `/videos/${id}?model=${encodeURIComponent(model)}`;
}

export function videoContentPath(provider: VideoModelProvider, requestId: string, model: string) {
    const id = encodeURIComponent(requestId);
    if (provider === "seedance") return `/contents/generations/tasks/${id}/content`;
    if (provider === "grok") return `/videos/${id}/content`;
    return `/videos/${id}/content?model=${encodeURIComponent(model)}`;
}

function isCompletedVideoStatus(status?: string) {
    return ["completed", "complete", "succeeded", "success", "done"].includes(String(status || "").trim().toLowerCase());
}

function isFailedVideoStatus(status?: string) {
    return ["failed", "cancelled", "canceled", "expired", "error"].includes(String(status || "").trim().toLowerCase());
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = (await prepareImageRequestDataUrls(references, options)).map((image) => image.dataUrl);
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const profile = getVideoModelProfile(modelOptionName(model), videoCapabilityOf(config, model));
    const mode = resolveVideoMode(config.videoMode, images.length, profile);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const parameters: Record<string, unknown> = {
            aspectRatio: videoAspectRatio(config.size),
            resolution: normalizeVideoResolution(config.vquality),
            generateAudio: boolConfig(config.videoGenerateAudio, true),
            addWatermark: boolConfig(config.videoWatermark, false),
        };
        if (config.videoDurationAuto !== true) {
            parameters.durationSeconds = Number(normalizeVideoSecondsForModel(config.videoSeconds, model, config)) || profile.defaultDuration;
        }
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters,
        }, { headers: geminiVideoHeaders(config), signal: options?.signal, timeout: 60_000 })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal, timeout: 30_000 })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new VideoPollingError(readAxiosError(error, apiText("videoTaskQueryFailed")), axios.isAxiosError(error) ? error.response?.status || 0 : 0);
    }
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    if (!url.startsWith("/")) {
        throw new Error("upstream video URLs are not exposed");
    }
    const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal, timeout: 60_000 });
    await assertVideoBlob(response.data);
    return { blob: response.data };
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSecondsForModel(value: string, model: string, config: AiConfig) {
    return clampVideoSecondsForProfile(value, getVideoModelProfile(modelOptionName(model), videoCapabilityOf(config, model)));
}

function resolveVideoMode(mode: string | undefined, imageCount: number, profile: VideoModelProfile) {
    const framesSupported = profile.modes.includes("image-to-video") || profile.modes.includes("first-last-frame");
    const referenceSupported = profile.modes.includes("reference-images");
    if (!framesSupported && referenceSupported) return "reference";
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return apiText("videoTimeout", { provider: "" });
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
