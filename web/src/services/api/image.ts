import axios from "axios";

import i18n from "@/i18n";
import { buildApiUrl, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { normalizePluginImages, runModelPlugin } from "./model-plugin";
import { nanoid } from "nanoid";
import { mapWithConcurrency } from "@/lib/concurrency";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { prepareImageRequestDataUrls, type PreparedImageRequest } from "@/services/image-storage";
import { imageSizePresets, inferMediaScale } from "@/lib/media-size";
import { isGeminiImageModel } from "@/lib/image-model";
import { shouldSkipClientImageNormalization } from "@/lib/image-normalization-policy";
import { imageOutputMimeType, normalizeImageBackground, normalizeImageOutputFormat } from "@/lib/image-output-format";
import type { ReferenceImage } from "@/types/image";
import { reportCanvasImageDisplay } from "@/services/image-display";
import { isLocalImagePassthrough, localImagePassthroughHeaders } from "@/lib/local-image-passthrough";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem =
    | { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem =
    | { type?: "message"; content?: Array<{ type?: string; text?: string }> }
    | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
export type GeneratedImageResult = { id: string; dataUrl: string; previewDataUrl?: string; objectKey?: string; serverRequestId?: string };
type DownloadProgress = {
    loaded: number;
    total: number;
    bytesPerSecond: number;
};
type RequestOptions = {
    signal?: AbortSignal;
    onPreview?: (images: GeneratedImageResult[]) => void;
    startedAt?: number;
    clientRequestId?: string;
    onDownloadStart?: () => void;
    onDownloadProgress?: (progress: DownloadProgress) => void;
};

const IMAGE_QUALITY_VALUES = ["low", "medium", "high", "xhigh", "max"];
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
// 与 image-storage 的下载超时保持一致，避免接口挂起时节点一直停在生成中。
const IMAGE_REQUEST_TIMEOUT_MS = 4 * 60_000;
// Async submission must upload the full request body before the server can
// return a task. Reference images may legitimately take longer than 30 seconds
// on mobile or tunneled connections; timing out here looked like a server-side
// body parsing failure because the browser closed the upload mid-request.
const IMAGE_TASK_SUBMIT_TIMEOUT_MS = 3 * 60_000;
const IMAGE_MODEL_READ_TIMEOUT_MS = 15_000;
const GEMINI_IMAGE_REQUEST_CONCURRENCY = 12;

const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    return IMAGE_QUALITY_VALUES.includes(value) ? value : undefined;
}

/** Map a bare ratio such as "1:1" to an explicit pixel dimension like "1024x1024". */
function resolveSize(ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const preset = imageSizePresets["1k"][ratio];
    if (preset) return preset;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    const shortSide = DEFAULT_IMAGE_SHORT_SIDE;
    const longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error(apiText("invalidImageSizeFormat"));
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error(apiText("positiveImageRatio"));
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error(apiText("imageRatioLimit"));
    return ratio;
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(apiText("positiveImageDimensions"));
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error(apiText("imageDimensionStep"));
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error(apiText("imageEdgeLimit"));
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error(apiText("imageRatioLimit"));
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error(apiText("imagePixelLimit"));
}

function resolveRequestSize(size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(value);
    throw new Error(apiText("invalidImageSizeFormat"));
}

function resolveGeminiImageConfig(config: AiConfig) {
    const value = config.size.trim();
    const dimensions = parseImageDimensions(value);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : value;
    const aspectRatio = value && value.toLowerCase() !== "auto" ? closestGeminiAspectRatio(ratio) : undefined;
    const imageSize = resolveGeminiImageSize(dimensions);
    const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
    return Object.keys(image).length ? { imageConfig: image } : {};
}

function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseRatioValue(item);
        const bestRatio = parseRatioValue(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

/** Gemini takes the resolution tier and the ratio separately; the tier comes from the size presets. */
function resolveGeminiImageSize(dimensions: { width: number; height: number } | null) {
    if (!dimensions) return undefined;
    const size = `${dimensions.width}x${dimensions.height}`;
    const scale = Object.keys(imageSizePresets).find((key) => Object.values(imageSizePresets[key]).includes(size));
    if (scale) return scale.toUpperCase();
    const edge = Math.max(dimensions.width, dimensions.height);
    if (edge <= 768) return "512";
    if (edge <= 1536) return "1K";
    if (edge <= 3072) return "2K";
    return "4K";
}

function resolveImageSource(item: Record<string, unknown>, fallbackOutputFormat: string | undefined) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        const declaredMime = [item.mime_type, item.mimeType]
            .find((value): value is string => typeof value === "string" && /^image\//i.test(value.trim()))
            ?.trim()
            .toLowerCase()
            .replace("image/jpg", "image/jpeg");
        const itemFormat = item.output_format ?? item.outputFormat;
        const mimeType = declaredMime || imageOutputMimeType(typeof itemFormat === "string" ? itemFormat : fallbackOutputFormat);
        return `data:${mimeType};base64,${item.b64_json}`;
    }
    for (const key of ["url", "display_url", "image_url"]) {
        if (typeof item[key] === "string" && item[key]) {
            return item[key] as string;
        }
    }
    const preview = resolveImagePreviewSource(item);
    if (preview) return preview;
    return null;
}

function resolveImagePreviewSource(item: Record<string, unknown>) {
    for (const key of ["preview_data_url", "preview_url", "previewDataUrl"]) {
        const value = item[key];
        if (typeof value === "string" && value) return value;
    }
    return undefined;
}

function responseRequestId(headers: unknown) {
    if (!headers) return "";
    const getter = (headers as { get?: (name: string) => unknown }).get;
    if (typeof getter === "function") {
        const value = getter.call(headers, "x-client-request-id");
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    const record = headers as Record<string, unknown>;
    const value = record["x-client-request-id"] ?? record["X-Client-Request-ID"];
    return typeof value === "string" ? value.trim() : "";
}

function attachServerRequestId(images: GeneratedImageResult[], headers: unknown) {
    const requestId = responseRequestId(headers);
    return requestId ? images.map((image) => ({ ...image, serverRequestId: requestId })) : images;
}

function parseImagePayload(payload: ImageApiResponse, fallbackOutputFormat?: string) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || apiText("requestFailed"));
    }
    // Support data, images, and results response fields used by different APIs.
    const imageList = payload.data
        || (payload as Record<string, unknown>).images as Array<Record<string, unknown>> | undefined
        || (payload as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined
        || [];
    const images: GeneratedImageResult[] = [];
    for (const item of imageList) {
        const dataUrl = resolveImageSource(item, fallbackOutputFormat);
        if (dataUrl) images.push({
            id: nanoid(),
            dataUrl,
            previewDataUrl: resolveImagePreviewSource(item),
            objectKey: typeof item.object_key === "string" && item.object_key.trim() ? item.object_key.trim() : undefined,
        });
    }

    if (images.length === 0) {
        // Check whether the response contains data in an unrecognized format.
        const rawKeys = Object.keys(payload).filter((k) => k !== "code" && k !== "msg" && k !== "error");
        throw new Error(rawKeys.length > 0
            ? apiText("unknownImageResponse", { fields: rawKeys.join(", ") })
            : apiText("noImageReturned"));
    }

    return images;
}

async function normalizeGeneratedImages(images: GeneratedImageResult[], outputFormat: string | undefined) {
    const target = normalizeImageOutputFormat(outputFormat);
    const normalized: GeneratedImageResult[] = [];
    for (const image of images) {
        normalized.push(await normalizeGeneratedImage(image, target));
    }
    return normalized;
}

async function normalizeGeneratedImage(image: GeneratedImageResult, targetFormat: "png" | "jpeg"): Promise<GeneratedImageResult> {
    // Never block the canvas on downloading or re-encoding a displayable image.
    if (shouldSkipClientImageNormalization(image)) return image;
    const source = image.dataUrl;
    const targetMime = imageOutputMimeType(targetFormat);
    const dataURLMime = source.startsWith("data:image/")
        ? source.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase().replace("image/jpg", "image/jpeg")
        : "";
    if (dataURLMime === targetMime) return image;
    const isRemote = /^https?:\/\//i.test(source);
    if (!source.startsWith("data:image/") && !isRemote) return image;
    if (typeof document === "undefined") return image;

    let bitmap: ImageBitmap | null = null;
    try {
        let sourceImage: CanvasImageSource;
        let width = 0;
        let height = 0;
        let blob: Blob | null = null;
        if (source.startsWith("data:") || isRemote) {
            blob = await (await fetch(source)).blob();
            if (blob.type && blob.type.toLowerCase().replace("image/jpg", "image/jpeg") === targetMime) return image;
        }
        if (!blob) return image;
        if (typeof createImageBitmap === "function") {
            bitmap = await createImageBitmap(blob);
            sourceImage = bitmap;
            width = bitmap.width;
            height = bitmap.height;
        } else {
            const element = await loadCanvasImage(source);
            sourceImage = element;
            width = element.naturalWidth;
            height = element.naturalHeight;
        }
        if (!width || !height) return image;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return image;
        if (targetFormat === "jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
        }
        context.drawImage(sourceImage, 0, 0, width, height);
        const dataUrl = canvas.toDataURL(targetMime, 0.94);
        return dataUrl.startsWith(`data:${targetMime};`) ? { ...image, dataUrl } : image;
    } catch {
        return image;
    } finally {
        bitmap?.close();
    }
}

function loadCanvasImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (/^https?:\/\//i.test(src)) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(apiText("imageReadFailed")));
        image.src = src;
    });
}

function imageMimeFromURL(source: string) {
    try {
        const pathname = new URL(source, window.location.href).pathname.toLowerCase();
        if (/\.(jpe?g)$/.test(pathname)) return "image/jpeg";
        if (/\.png$/.test(pathname)) return "image/png";
        if (/\.webp$/.test(pathname)) return "image/webp";
        if (/\.gif$/.test(pathname)) return "image/gif";
    } catch {
        return "";
    }
    return "";
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        // The value may be serialized JSON, such as error.message, or a plain-text error.
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            // Treat an empty parsed object such as "{}" as having no useful message.
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            // Detect HTML error pages.
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
    if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return apiText("imageTimeout");
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        // Prefer the API error from the response body.
        const apiMsg = readApiErrorMessage(responseData);
        if (apiMsg) return apiMsg;
        // Infer the error from the HTTP status when the response body has no usable message.
        const statusMsg = readStatusError(error.response?.status, fallback);
        if (statusMsg) return statusMsg;
        // Fall back to Axios's own error message.
        return error.message || fallback;
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    if (status === 404) return apiText("notFound");
    if (status === 502) return apiText("badGateway");
    if (status === 503) return apiText("serviceBusy");
    return status ? apiText("httpFailed", { status }) : fallback;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}


function createDownloadProgressHandler(options?: RequestOptions) {
    let notified = false;
    return (event?: { loaded?: number; total?: number; rate?: number }) => {
        if (!notified) {
            notified = true;
            options?.onDownloadStart?.();
        }
        options?.onDownloadProgress?.({
            loaded: Math.max(0, Number(event?.loaded) || 0),
            total: Math.max(0, Number(event?.total) || 0),
            bytesPerSecond: Math.max(0, Number(event?.rate) || 0),
        });
    };
}

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string, clientRequestId?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(clientRequestId ? { "X-Client-Request-ID": clientRequestId } : {}),
        ...localImagePassthroughHeaders(),
    };
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    if (lowerBaseUrl.endsWith("/v1beta")) return normalizedBaseUrl;
    if (lowerBaseUrl.endsWith("/v1")) {
        return `${normalizedBaseUrl.slice(0, -3)}/v1beta`;
    }
    return `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return withLocalProxy(`${baseUrl}/models`);
    return withLocalProxy(`${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`);
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">, clientRequestId?: string) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
        ...(clientRequestId ? { "X-Client-Request-ID": clientRequestId } : {}),
        ...localImagePassthroughHeaders(),
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || apiText("requestFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(apiText("geminiRejected", { reason: payload.promptFeedback.blockReason }));
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, apiText("requestFailed")));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [
        config.systemPrompt.trim(),
        ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : [])),
    ]
        .filter(Boolean)
        .join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig =
        typeof toolChoice === "object"
            ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] }
            : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config, options?.clientRequestId),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, apiText("requestFailed")));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions): Promise<GeneratedImageResult[]> {
    const prepared = await prepareImageRequestDataUrls(references, options);
    const requests = await mapWithConcurrency(Array.from({ length: count }, (_, index) => index), GEMINI_IMAGE_REQUEST_CONCURRENCY, () => requestGeminiImagesOnce(config, prompt, prepared, options));
    return requests.flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: PreparedImageRequest[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }, ...references.map((image) => toGeminiImagePart(image.dataUrl))];
    const request = {
        ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(config) } }),
        contents: [{ role: "user", parts }],
    };
    const asyncResult = isLocalImagePassthrough() ? null : await requestGeminiImagesAsync(config, request, options);
    if (asyncResult) return asyncResult;
    try {
        const response = await axios.post<GeminiPayload>(
            geminiApiUrl(config, "generateContent"),
            request,
            { headers: geminiHeaders(config, options?.clientRequestId), signal: options?.signal, timeout: IMAGE_REQUEST_TIMEOUT_MS, onDownloadProgress: createDownloadProgressHandler(options) },
        );
        return attachServerRequestId(parseGeminiImagePayload(response.data), response.headers);
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("requestFailed")));
    }
}

type AsyncImageTaskResponse = {
    id?: string;
    task_id?: string;
    poll_url?: string;
    status?: string;
    result?: unknown;
    error?: unknown;
    message?: string;
    refund_status?: "refunded";
    refund_amount?: number;
    refunded_at?: number;
};

export type PersistentImageTask = {
    taskId: string;
    pollUrl: string;
    provider: "gemini" | "openai";
};

export async function submitPersistentImageTask(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[],
    options?: RequestOptions,
): Promise<PersistentImageTask | null> {
    if (isLocalImagePassthrough()) return null;
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    if (requestConfig.apiFormat === "gemini" || isGeminiImageModel(requestConfig.model)) {
        const prepared = await prepareImageRequestDataUrls(references, options);
        const request = {
            ...toGeminiBody(requestConfig, [{ role: "user", content: requestPrompt }], {
                generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"],
                    ...resolveGeminiImageConfig(requestConfig),
                },
            }),
            contents: [{
                role: "user",
                parts: [
                    { text: requestPrompt },
                    ...prepared.map((image) => toGeminiImagePart(image.dataUrl)),
                ],
            }],
        };
        return submitAsyncImageTask(
            requestConfig,
            "/images/generations/async",
            {
                model: requestConfig.model,
                request,
                output_format: normalizeImageOutputFormat(requestConfig.outputFormat),
            },
            "application/json",
            "gemini",
            options,
        );
    }

    if (references.length === 0) {
        const outputFormat = normalizeImageOutputFormat(requestConfig.outputFormat);
        const background = normalizeImageBackground(requestConfig.model, requestConfig.background, outputFormat);
        const payload: Record<string, unknown> = {
            model: requestConfig.model,
            prompt: withSystemPrompt(requestConfig, requestPrompt),
            n: 1,
            output_format: outputFormat,
        };
        if (requestConfig.size) payload.size = resolveRequestSize(requestConfig.size);
        if (requestConfig.quality) payload.quality = normalizeQuality(requestConfig.quality);
        if (background) payload.background = background;
        return submitAsyncImageTask(requestConfig, "/images/generations/async", payload, "application/json", "openai", options);
    }

    const outputFormat = normalizeImageOutputFormat(requestConfig.outputFormat);
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", "1");
    if (!/gpt-image/.test(requestConfig.model)) formData.set("response_format", "b64_json");
    formData.set("output_format", outputFormat);
    const quality = normalizeQuality(requestConfig.quality);
    const requestSize = resolveRequestSize(requestConfig.size);
    const background = normalizeImageBackground(requestConfig.model, requestConfig.background, outputFormat);
    if (quality) formData.set("quality", quality);
    if (requestSize) formData.set("size", requestSize);
    if (background) formData.set("background", background);
    const prepared = await prepareImageRequestDataUrls(references, options);
    const files = prepared.map((image, index) => dataUrlToFile({
        id: `reference-${index}`,
        name: `reference-${index + 1}.${image.mimeType.includes("jpeg") ? "jpg" : image.mimeType.includes("webp") ? "webp" : "png"}`,
        type: image.mimeType,
        dataUrl: image.dataUrl,
    }));
    const imageField = files.length > 1 ? "image[]" : "image";
    files.forEach((file) => formData.append(imageField, file));
    return submitAsyncImageTask(requestConfig, "/images/edits/async", formData, "", "openai", options);
}

export async function waitForPersistentImageTask(
    config: AiConfig,
    task: PersistentImageTask,
    options?: RequestOptions,
) {
    return pollImageTask(config, task.pollUrl, options, task.taskId);
}

async function submitAsyncImageTask(
    config: AiConfig,
    path: string,
    data: unknown,
    contentType: string,
    provider: "gemini" | "openai",
    options?: RequestOptions,
): Promise<PersistentImageTask | null> {
    let response;
    try {
        response = await axios.post<AsyncImageTaskResponse>(
            aiApiUrl(config, path),
            data,
            {
                headers: {
                    ...aiHeaders(config, contentType || undefined, options?.clientRequestId),
                    "Idempotency-Key": nanoid(),
                },
                signal: options?.signal,
                timeout: IMAGE_TASK_SUBMIT_TIMEOUT_MS,
                validateStatus: () => true,
            },
        );
    } catch (error) {
        if (axios.isCancel(error)) throw error;
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            if (status === 404 || status === 405 || status === 501) return null;
            throw new Error(readAxiosError(error, apiText("requestFailed")));
        }
        throw error;
    }
    if (response.status === 404 || response.status === 405 || response.status === 501) return null;
    if (response.status < 200 || response.status >= 300) {
        throw new Error(readApiErrorMessage(response.data) || readStatusError(response.status, apiText("requestFailed")));
    }
    const taskId = String(response.data?.task_id || response.data?.id || "").trim();
    const pollUrl = String(response.data?.poll_url || "").trim();
    if (!taskId || !pollUrl) throw new Error(apiText("requestFailed"));
    return { taskId, pollUrl: resolvePollURL(config, pollUrl), provider };
}

async function requestGeminiImagesAsync(
    config: AiConfig,
    request: Record<string, unknown>,
    options?: RequestOptions,
) {
    let submit
    try {
        submit = await axios.post<AsyncImageTaskResponse>(
            aiApiUrl(config, "/images/generations/async"),
            {
                model: config.model,
                request,
                output_format: normalizeImageOutputFormat(config.outputFormat),
            },
            {
                headers: {
                    ...aiHeaders(config, "application/json", options?.clientRequestId),
                    "Idempotency-Key": nanoid(),
                },
                signal: options?.signal,
                timeout: IMAGE_TASK_SUBMIT_TIMEOUT_MS,
                validateStatus: () => true,
            },
        )
    } catch (error) {
        if (axios.isCancel(error)) throw error
        if (axios.isAxiosError(error)) {
            const status = error.response?.status
            if (status === 404 || status === 405 || status === 501) return null
            throw new Error(readAxiosError(error, apiText("requestFailed")))
        }
        throw error
    }
    if (submit.status === 404 || submit.status === 405 || submit.status === 501) return null
    if (submit.status < 200 || submit.status >= 300) {
        throw new Error(readApiErrorMessage(submit.data) || readStatusError(submit.status, apiText("requestFailed")))
    }
    const task = submit.data
    if (!task?.poll_url) throw new Error(apiText("requestFailed"))
    return pollImageTask(config, resolvePollURL(config, task.poll_url), options, String(task.id || ""))
}

function resolvePollURL(config: AiConfig, pollURL: string) {
    if (/^https?:\/\//i.test(pollURL)) return withLocalProxy(pollURL)
    const fallbackOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost"
    const apiOrigin = new URL(config.baseUrl || fallbackOrigin, fallbackOrigin).origin
    return withLocalProxy(new URL(pollURL, apiOrigin).toString())
}

async function pollImageTask(
    config: AiConfig,
    url: string,
    options?: RequestOptions,
    taskId?: string,
) {
    const deadline = Date.now() + 5 * 60_000
    let previewDelivered = false
    while (Date.now() < deadline) {
        if (options?.signal?.aborted) throw new Error(apiText("requestCanceled"))
        let response
        try {
            response = await axios.get<AsyncImageTaskResponse>(url, {
                headers: aiHeaders(config),
                signal: options?.signal,
                timeout: Math.min(30_000, Math.max(1, deadline - Date.now())),
            })
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("requestFailed")))
        }
        const task = response.data
        const result = typeof task.result === "string" ? JSON.parse(task.result) : task.result
        if (task.status === "ready" || task.status === "completed") {
            if (!result) throw new Error(apiText("noImageReturned"))
            if (hasPendingImageOriginal(result)) {
                if (!previewDelivered) {
                    try {
                        const previews = parseImagePayload(result as ImageApiResponse, config.outputFormat)
                        if (previews.length) {
                            previewDelivered = true
                            options?.onPreview?.(previews)
                        }
                    } catch {
                        // The final original is still pending; keep polling.
                    }
                }
                await waitForAsyncImagePoll(500, options?.signal)
                continue
            }
            const images = attachServerRequestId(parseImagePayload(result as ImageApiResponse, config.outputFormat), response.headers)
            reportCanvasImageDisplay(taskId, options?.startedAt)
            return images
        }
        if (task.status === "preview_ready" && !previewDelivered) {
            try {
                const images = result ? parseImagePayload(result as ImageApiResponse, config.outputFormat) : []
                if (images.length) {
                    previewDelivered = true
                    reportCanvasImageDisplay(taskId, options?.startedAt)
                    options?.onPreview?.(attachServerRequestId(images, response.headers))
                }
            } catch {
                // Keep polling for the final persisted image.
            }
        }
        if (task.status === "failed") {
            throw new Error(readApiErrorMessage(task.error) || task.message || apiText("requestFailed"))
        }
        await waitForAsyncImagePoll(500, options?.signal)
    }
    throw new Error(apiText("imageTimeout"))
}

function hasPendingImageOriginal(result: unknown) {
    if (!result || typeof result !== "object") return false;
    const data = (result as Record<string, unknown>).data
        || (result as Record<string, unknown>).images
        || (result as Record<string, unknown>).results;
    if (!Array.isArray(data)) return false;
    return data.some((item) => {
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        const uploadStatus = String(record.upload_status || "").trim().toLowerCase();
        const hasOriginal = typeof record.b64_json === "string" && record.b64_json
            || typeof record.url === "string" && record.url
            || typeof record.display_url === "string" && record.display_url
            || typeof record.image_url === "string" && record.image_url;
        return uploadStatus === "pending" && !hasOriginal;
    });
}

function waitForAsyncImagePoll(delay: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error(apiText("requestCanceled")))
            return
        }
        const timer = window.setTimeout(resolve, delay)
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer)
            reject(new Error(apiText("requestCanceled")))
        }, { once: true })
    })
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error(apiText("geminiNoImage"));
    return images;
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<GeneratedImageResult[]> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const script = resolveModelScript(config, config.model || config.imageModel);
    const outputFormat = normalizeImageOutputFormat(config.outputFormat);
    const background = normalizeImageBackground(requestConfig.model, config.background, outputFormat);
    if (script) {
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(config.size);
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, prompt),
                images: [],
                params: { size: requestSize, resolution: inferMediaScale(config.size), quality, count: n, format: outputFormat, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizeGeneratedImages(
                normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl })),
                outputFormat,
            );
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("requestFailed")));
        }
    }
    if (requestConfig.apiFormat === "gemini" || isGeminiImageModel(requestConfig.model)) {
        try {
            return normalizeGeneratedImages(
                await requestGeminiImages(requestConfig, prompt, [], n, options),
                outputFormat,
            );
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("requestFailed")));
        }
    }
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(config.size);
    try {
        const response = await axios.post<ImageApiResponse>(
            aiApiUrl(requestConfig, "/images/generations"),
            {
                model: requestConfig.model,
                prompt: withSystemPrompt(requestConfig, prompt),
                n,
                ...(quality ? { quality } : {}),
                ...(requestSize ? { size: requestSize } : {}),
                ...(background ? { background } : {}),
                // gpt-image models reject response_format; they always return b64.
                ...(/gpt-image/.test(requestConfig.model) ? {} : { response_format: "b64_json" }),
                output_format: outputFormat,
            },
            {
                headers: aiHeaders(requestConfig, "application/json", options?.clientRequestId),
                signal: options?.signal,
                timeout: IMAGE_REQUEST_TIMEOUT_MS,
                onDownloadProgress: createDownloadProgressHandler(options),
            },
        );
        const images = attachServerRequestId(await parseImagePayload(response.data, outputFormat), response.headers);
        return normalizeGeneratedImages(images, outputFormat);
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("requestFailed")));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<GeneratedImageResult[]> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const script = resolveModelScript(config, config.model || config.imageModel);
    const outputFormat = normalizeImageOutputFormat(config.outputFormat);
    const background = normalizeImageBackground(requestConfig.model, config.background, outputFormat);
    const preparedReferences = references.length ? await prepareImageRequestDataUrls(references, options) : [];
    if (script) {
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(config.size);
        const refs = preparedReferences.map((image) => image.dataUrl);
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, requestPrompt),
                images: refs,
                params: { size: requestSize, resolution: inferMediaScale(config.size), quality, count: n, format: outputFormat, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizeGeneratedImages(
                normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl })),
                outputFormat,
            );
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("requestFailed")));
        }
    }
    if (requestConfig.apiFormat === "gemini" || isGeminiImageModel(requestConfig.model)) {
        try {
            return normalizeGeneratedImages(
                await requestGeminiImages(requestConfig, requestPrompt, references, n, options),
                outputFormat,
            );
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("requestFailed")));
        }
    }

    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(config.size);
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    // gpt-image models reject response_format; they always return b64.
    if (!/gpt-image/.test(requestConfig.model)) {
        formData.set("response_format", "b64_json");
    }
    formData.set("output_format", outputFormat);
    if (quality) {
        formData.set("quality", quality);
    }
    if (requestSize) {
        formData.set("size", requestSize);
    }
    if (background) {
        formData.set("background", background);
    }
    const files = preparedReferences.map((image, index) => dataUrlToFile({
        id: `reference-${index}`,
        name: `reference-${index + 1}.${image.mimeType.includes("jpeg") ? "jpg" : image.mimeType.includes("webp") ? "webp" : "png"}`,
        type: image.mimeType,
        dataUrl: image.dataUrl,
    }));
    const imageField = files.length > 1 ? "image[]" : "image";
    files.forEach((file) => formData.append(imageField, file));

    try {
        const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/edits"), formData, { headers: aiHeaders(requestConfig, undefined, options?.clientRequestId), signal: options?.signal, timeout: IMAGE_REQUEST_TIMEOUT_MS, onDownloadProgress: createDownloadProgressHandler(options) });
        const images = attachServerRequestId(await parseImagePayload(response.data, outputFormat), response.headers);
        return normalizeGeneratedImages(images, outputFormat);
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("requestFailed")));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    const script = resolveModelScript(config, config.model || config.textModel);
    if (script) {
        try {
            const answer = await runModelPlugin<string>({
                capability: "text",
                script,
                config: requestConfig,
                messages: withSystemMessage(requestConfig, messages),
                signal: options?.signal,
                onDelta,
            });
            const text = String(answer ?? "").trim() || apiText("noContent");
            if (text === apiText("noContent")) onDelta(text);
            return text;
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("requestFailed")));
        }
    }
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || apiText("noContent");
            if (answer === apiText("noContent")) onDelta(answer);
            return answer;
        }
        const answer = (await requestStreamingResponse(requestConfig, {
            model: requestConfig.model,
            input: toResponseInput(withSystemMessage(requestConfig, messages)),
            ...(requestConfig.reasoningEffort === "auto" ? {} : { reasoning: { effort: requestConfig.reasoningEffort } }),
        }, onDelta, options)).content || apiText("noContent");
        if (answer === apiText("noContent")) onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("requestFailed")));
    }
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (config.apiFormat === "gemini") {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }), timeout: IMAGE_MODEL_READ_TIMEOUT_MS });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
            timeout: IMAGE_MODEL_READ_TIMEOUT_MS,
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("modelReadFailed")));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};
