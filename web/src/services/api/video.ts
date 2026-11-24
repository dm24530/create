import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { computeVideoSize, inferVideoRatio, normalizeVideoResolutionToken } from "@/lib/media-size";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { createRequest } from "@/services/create-api";
import { useUserStore } from "@/stores/use-user-store";
import { prepareImageRequestDataUrls } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, videoCapabilityOf, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoResolutionSupported, resolveVideoModeForMedia, resolveVideoModeMediaPolicy, resolveVideoModeProfile, resolveVideoParameterValues, resolveVideoResolutionForProfile, type VideoMediaFieldSpec, type VideoMediaRole, type VideoModelProfile, type VideoModelProvider, type VideoRequestSchema } from "@/lib/video-model-profile";
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
    imageMode?: "frames" | "reference";
    selectedMode?: string;
    parameters?: Record<string, unknown>;
};

const VIDEO_REQUEST_PROTECTED_KEYS = new Set([
    "model", "prompt", "duration", "seconds", "resolution", "aspect_ratio", "size", "mode",
    "content", "ratio", "generate_audio", "images", "image_urls", "keyframes", "first_frame_image_url",
    "last_frame_image_url", "reference_image_urls", "reference_audio_urls", "reference_video_urls",
    "reference_video_url", "first_frame_url", "last_frame_url", "image", "video",
]);

const DEFAULT_VIDEO_MEDIA_FIELDS: Record<VideoMediaRole, VideoMediaFieldSpec> = {
    first_frame: "first_frame_image_url",
    last_frame: "last_frame_image_url",
    image: "first_frame_image_url",
    reference_images: "reference_image_urls",
    reference_videos: "reference_video_urls",
    reference_audio: "reference_audio_urls",
    edit_video: { field: "reference_video_urls", multiple: true },
    extension_video: { field: "reference_video_urls", multiple: true },
    keyframes: { field: "keyframe_image_urls", multiple: true },
};

function mediaFieldFor(profile: VideoModelProfile, provider: VideoModelProvider, role: VideoMediaRole): VideoMediaFieldSpec {
    const configured = profile.requestSchema.media_fields?.[role];
    if (configured) return configured;
    if (provider === "momo_video") {
        if (role === "image") return { field: "images", multiple: true };
        if (role === "edit_video" || role === "extension_video") return { field: "reference_video_url", multiple: false };
    }
    if (role === "image" && provider === "seedance_video") return { field: "images", multiple: true };
    if (role === "reference_images" || role === "reference_videos" || role === "reference_audio") {
        return { field: DEFAULT_VIDEO_MEDIA_FIELDS[role] as string, multiple: true };
    }
    return DEFAULT_VIDEO_MEDIA_FIELDS[role];
}

function writeVideoMedia(body: Record<string, unknown>, profile: VideoModelProfile, provider: VideoModelProvider, role: VideoMediaRole, urls: string[]) {
    if (!urls.length) return;
    const spec = mediaFieldFor(profile, provider, role);
    const field = typeof spec === "string" ? spec : spec.field;
    const multiple = typeof spec === "string" ? false : spec.multiple === true;
    if (!field) return;
    body[field] = multiple ? [...urls] : urls[0];
}

function applyVideoMedia(body: Record<string, unknown>, mode: string, input: VideoProviderRequestInput, provider: VideoModelProvider, profile: VideoModelProfile) {
    const policy = resolveVideoModeMediaPolicy(profile, mode);
    if (provider === "momo_video" && mode === "keyframes") {
        const urls = input.imageUrls.slice(0, policy.max_images);
        if (urls.length) body.keyframes = urls.map((image_url, index) => ({ timestamp_s: index + 1, image_url }));
        return;
    }
    if (mode === "first-last-frame") {
        writeVideoMedia(body, profile, provider, "first_frame", input.imageUrls.slice(0, Math.min(1, policy.max_images)));
        writeVideoMedia(body, profile, provider, "last_frame", input.imageUrls.slice(1, Math.min(2, policy.max_images)));
        return;
    }
    writeVideoMedia(body, profile, provider, policy.image_role, input.imageUrls.slice(0, policy.max_images));
    if (policy.max_videos > 0) writeVideoMedia(body, profile, provider, policy.video_role, input.videoUrls.slice(0, policy.max_videos));
    if (policy.max_audios > 0) writeVideoMedia(body, profile, provider, policy.audio_role, input.audioUrls.slice(0, policy.max_audios));
}

function protectedVideoRequestKeys(profile: VideoModelProfile, provider: VideoModelProvider) {
    const keys = new Set(VIDEO_REQUEST_PROTECTED_KEYS);
    for (const role of Object.keys(DEFAULT_VIDEO_MEDIA_FIELDS) as VideoMediaRole[]) {
        const spec = mediaFieldFor(profile, provider, role);
        keys.add(typeof spec === "string" ? spec : spec.field);
    }
    return keys;
}

function applyVideoParameters(body: Record<string, unknown>, input: VideoProviderRequestInput, profile: VideoModelProfile, provider: VideoModelProvider) {
    const parameters = resolveVideoParameterValues(profile, input.parameters);
    const protectedKeys = protectedVideoRequestKeys(profile, provider);
    for (const [key, value] of Object.entries(parameters)) {
        if (protectedKeys.has(key) || value === undefined) continue;
        body[key] = value;
    }
}

function expandVideoPath(template: string, requestId: string, model: string) {
    return template
        .replaceAll("{id}", encodeURIComponent(requestId))
        .replaceAll("{model}", encodeURIComponent(model));
}

function defaultVideoCreatePath(provider: VideoModelProvider) {
    if (provider === "seedance") return "/contents/generations/tasks";
    if (provider === "openai_video") return "/videos";
    return "/video/generations";
}

function defaultVideoTaskPath(provider: VideoModelProvider, requestId: string, model: string) {
    const id = encodeURIComponent(requestId);
    if (provider === "seedance") return `/contents/generations/tasks/${id}`;
    if (provider === "grok") return `/videos/${id}`;
    return `/videos/${id}?model=${encodeURIComponent(model)}`;
}

function defaultVideoContentPath(provider: VideoModelProvider, requestId: string, model: string) {
    const id = encodeURIComponent(requestId);
    if (provider === "seedance") return `/contents/generations/tasks/${id}/content`;
    if (provider === "grok") return `/videos/${id}/content`;
    return `/videos/${id}/content?model=${encodeURIComponent(model)}`;
}

export function buildVideoProviderRequest(provider: VideoModelProvider, input: VideoProviderRequestInput, profile?: VideoModelProfile): { path: string; body: Record<string, unknown> } {
    const effectiveProfile = profile || getVideoModelProfile(input.model);
    if ((provider === "seedance" || provider === "openai_video") && Object.keys(effectiveProfile.requestSchema.media_fields || {}).length) {
        throw new Error(apiText("unsupportedMediaSchema", { protocol: provider }));
    }
    const mode = resolveVideoModeForMedia(effectiveProfile, input.selectedMode || input.imageMode, {
        imageCount: input.imageUrls.length,
        videoCount: input.videoUrls.length,
        audioCount: input.audioUrls.length,
    });
    const modeProfile = resolveVideoModeProfile(effectiveProfile, mode);
    const requestedResolution = normalizeVideoResolution(input.resolution);
    const resolution = isVideoResolutionSupported(modeProfile, requestedResolution) ? resolveVideoResolutionForProfile(modeProfile, requestedResolution) : modeProfile.resolutions[0] || requestedResolution;
    const durationSeconds = Number(clampVideoSecondsForProfile(input.durationSeconds, modeProfile));
    const aspectRatio = resolveVideoAspectRatio(input.aspectRatio, modeProfile);
    const createPath = effectiveProfile.requestSchema.create_path || defaultVideoCreatePath(provider);
    if (provider === "seedance") {
        const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
        const imageRole = mode === "first-last-frame" ? "frame" : mode === "image-to-video" ? "first_frame" : "reference_image";
        input.imageUrls.forEach((url, index) => {
            content.push({
                type: "image_url",
                image_url: { url },
                role: imageRole === "frame" ? (index === 0 ? "first_frame" : "last_frame") : imageRole,
            });
        });
        input.videoUrls.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
        input.audioUrls.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
        const body: Record<string, unknown> = {
            model: input.model,
            content,
            resolution: normalizeVideoResolution(resolution),
            ratio: aspectRatio,
            generate_audio: input.generateAudio,
            mode,
        };
        if (!input.durationAuto) body.duration = durationSeconds;
        applyVideoParameters(body, input, effectiveProfile, provider);
        return { path: createPath, body };
    }

    if (provider === "openai_video") {
        const body: Record<string, unknown> = {
            model: input.model,
            prompt: input.prompt,
            resolution: normalizeVideoResolution(resolution),
            aspect_ratio: aspectRatio,
            generate_audio: input.generateAudio,
            mode,
        };
        if (!input.durationAuto) {
            body.seconds = durationSeconds;
            body.duration = durationSeconds;
        }
        applyVideoMedia(body, mode, input, provider, effectiveProfile);
        applyVideoParameters(body, input, effectiveProfile, provider);
        return { path: createPath, body };
    }

    const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        resolution: normalizeVideoResolution(resolution),
        aspect_ratio: aspectRatio,
    };
    // Momo infers media modes from their fields; only edit/extension require an explicit mode.
    if (provider !== "momo_video" || mode === "video-edit" || mode === "video-extension") body.mode = mode;
    if (!input.durationAuto) body.duration = durationSeconds;
    if (modeProfile.supportsGenerateAudio) body.generate_audio = input.generateAudio;
    applyVideoMedia(body, mode, input, provider, effectiveProfile);
    applyVideoParameters(body, input, effectiveProfile, provider);
    return { path: createPath, body };
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
    const profile = getVideoModelProfile(modelOptionName(model), videoCapabilityOf(config, model));
    const mode = resolveVideoModeForMedia(profile, config.videoMode, { imageCount: refs.length, videoCount: videos.length, audioCount: audios.length });
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
                ...resolveVideoParameterValues(profile, config.videoParameters),
                seconds: normalizeVideoSecondsForModel(config.videoSeconds, model, config),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: resolveVideoAspectRatio(config.size, profile),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode,
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
        aspectRatio: resolveVideoAspectRatio(config.size, profile),
        generateAudio: boolConfig(config.videoGenerateAudio, true),
        imageUrls,
        videoUrls,
        audioUrls,
        selectedMode: config.videoMode,
        parameters: config.videoParameters,
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
        const profile = getVideoModelProfile(model, videoCapabilityOf(config, task.model));
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, videoTaskPath(provider, task.id, model, profile.requestSchema)), { headers: aiHeaders(config), signal: options?.signal, timeout: 30_000 })).data);
        if (isCompletedVideoStatus(video.status)) {
            const content = await axios.get<Blob>(aiApiUrl(config, videoContentPath(provider, task.id, model, profile.requestSchema)), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal, timeout: 120_000 });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (isFailedVideoStatus(video.status)) return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new VideoPollingError(readAxiosError(error, apiText("videoTaskQueryFailed")), axios.isAxiosError(error) ? error.response?.status || 0 : 0);
    }
}

export function videoTaskPath(provider: VideoModelProvider, requestId: string, model: string, schema?: VideoRequestSchema) {
    if (schema?.task_path) return expandVideoPath(schema.task_path, requestId, model);
    return defaultVideoTaskPath(provider, requestId, model);
}

export function videoContentPath(provider: VideoModelProvider, requestId: string, model: string, schema?: VideoRequestSchema) {
    if (schema?.content_path) return expandVideoPath(schema.content_path, requestId, model);
    return defaultVideoContentPath(provider, requestId, model);
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
    if (Object.keys(profile.requestSchema.media_fields || {}).length) throw new Error(apiText("unsupportedMediaSchema", { protocol: "gemini" }));
    const mode = resolveVideoModeForMedia(profile, config.videoMode, { imageCount: images.length, videoCount: videos.length, audioCount: audios.length });
    const instance: Record<string, unknown> = { prompt };
    if (mode === "first-last-frame" || mode === "image-to-video") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (mode === "first-last-frame" && images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const parameters: Record<string, unknown> = {
            ...resolveVideoParameterValues(profile, config.videoParameters),
            aspectRatio: resolveVideoAspectRatio(config.size, profile),
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

function resolveVideoAspectRatio(size: string, profile?: VideoModelProfile) {
    const ratio = inferVideoRatio(size);
    if (ratio !== "auto") return ratio;
    return profile?.supportsAdaptiveRatio ? "adaptive" : "16:9";
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
    const token = normalizeVideoResolutionToken(value) || "720";
    return /^[248]k$/i.test(token) ? token : `${token}p`;
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
