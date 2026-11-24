import { defaultConfig, modelOptionName, resolveModelForCapability, videoCapabilityOf, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { claimLegacyStoredImage, ensureImagePreview, getImageBlob, prepareImageRequestDataUrls, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import { normalizeImageBackground, normalizeImageOutputFormat } from "@/lib/image-output-format";
import { computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { clampVideoSecondsForProfile, getVideoModelProfile, isVideoRatioSupported, isVideoResolutionSupported, normalizeVideoModeValue, resolveVideoModeProfile } from "@/lib/video-model-profile";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    const mimeSubtype = dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
    const normalized = mimeSubtype.trim().toLowerCase();
    if (normalized === "jpg" || normalized === "jpeg") return "jpg";
    if (normalized && normalized !== "png") return normalized;
    return dataUrl.match(/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i)?.[1]?.toLowerCase().replace("jpeg", "jpg") || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            if (url.startsWith("image:")) await claimLegacyStoredImage(url);
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? {
                id: `${index}`,
                name: `reference-${index}.png`,
                type: "image/png",
                dataUrl,
                url: /^https?:\/\//i.test(dataUrl) ? dataUrl : undefined,
                storageKey: url.startsWith("image:") ? url : undefined,
            } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function prepareCanvasReferenceImagesForRequest(_projectId: string, references: ReferenceImage[]) {
    if (!references.length) return references;
    const prepared = await prepareImageRequestDataUrls(references.map((image) => ({ ...image, url: undefined })));
    return references.map((image, index) => {
        const requestImage = prepared[index];
        if (!requestImage) return image;
        return {
            ...image,
            type: requestImage.mimeType,
            dataUrl: requestImage.dataUrl,
            url: undefined,
            storageKey: undefined,
            width: requestImage.width || image.width,
            height: requestImage.height || image.height,
            bytes: requestImage.bytes,
            requestDataUrlPrepared: true,
        };
    });
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            try {
                const metadata = node.metadata;
                const content = metadata?.content;
                if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata?.storageKey) {
                    const resolved = await resolveMediaUrl(metadata.storageKey, content).catch(() => content);
                    return { ...node, metadata: { ...metadata, content: resolved } };
                }
                if (node.type !== CanvasNodeType.Image || !metadata || !content) return node;
                await claimLegacyStoredImage(metadata.storageKey);
                const images = await Promise.all(
                    (metadata.images || []).map(async (image) => {
                        if (!image.content) return image;
                        await claimLegacyStoredImage(image.storageKey);
                        void ensureImagePreview(image.storageKey);
                        const resolved = await resolveImageUrl(image.storageKey, image.content).catch(() => image.content);
                        return { ...image, content: resolved };
                    }),
                );
                if (metadata.storageKey) {
                    void ensureImagePreview(metadata.storageKey);
                    const resolved = await resolveImageUrl(metadata.storageKey, content).catch(() => content);
                    return { ...node, metadata: { ...metadata, content: resolved, images } };
                }
                if (!content.startsWith("data:image/")) return node;
                try {
                    return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)) } };
                } catch {
                    return node;
                }
            } catch {
                return node;
            }
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) {
            const dataUrl = await resolveImageUrl(item.storageKey, item.dataUrl).catch(() => item.dataUrl);
            return { ...item, dataUrl };
        }
        if (item.dataUrl?.startsWith("data:image/")) {
            try {
                const image = await uploadImage(item.dataUrl);
                return { ...item, dataUrl: image.url, storageKey: image.storageKey };
            } catch {
                return item;
            }
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    const resources = [...new Map(inputs.flatMap((input) => (input.type === "group" ? input.children : [input])).map((input) => [input.nodeId, input])).values()];
    return {
        textCount: resources.filter((input) => input.type === "text").length,
        imageCount: resources.filter((input) => input.type === "image").length,
        videoCount: resources.filter((input) => input.type === "video").length,
        audioCount: resources.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const model = resolveModelForCapability(config, node?.metadata?.model, mode);
    const outputFormat = normalizeImageOutputFormat(node?.metadata?.outputFormat || config.outputFormat || defaultConfig.outputFormat);
    const background = normalizeImageBackground(model, node?.metadata?.background ?? config.background ?? defaultConfig.background, outputFormat);
    const requestedSize = node?.metadata?.size || config.size || defaultConfig.size;
    const requestedVquality = node?.metadata?.vquality || config.vquality || defaultConfig.vquality;
    const requestedSeconds = node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds;
    const videoProfile = mode === "video" ? getVideoModelProfile(modelOptionName(model), videoCapabilityOf(config, model)) : null;
    const requestedVideoMode = node?.metadata?.videoMode || config.videoMode || defaultConfig.videoMode;
    const normalizedVideoMode = videoProfile ? normalizeVideoModeValue(requestedVideoMode, videoProfile) : requestedVideoMode;
    const videoMode = videoProfile && normalizedVideoMode === "auto" ? videoProfile.modes[0] || "text-to-video" : normalizedVideoMode;
    const modeProfile = videoProfile ? resolveVideoModeProfile(videoProfile, videoMode) : null;
    const requestedRatio = inferVideoRatio(requestedSize);
    const videoResolution = modeProfile && isVideoResolutionSupported(modeProfile, requestedVquality)
        ? requestedVquality
        : modeProfile?.resolutions[0] || requestedVquality;
    const videoRatio = videoProfile && isVideoRatioSupported(videoProfile, requestedRatio)
        ? requestedRatio
        : videoProfile?.aspectRatios[0] || requestedRatio;
    return {
        ...config,
        model,
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: videoProfile ? computeVideoSize(videoResolution, videoRatio) : requestedSize,
        background,
        outputFormat,
        videoSeconds: modeProfile ? clampVideoSecondsForProfile(requestedSeconds, modeProfile) : requestedSeconds,
        vquality: videoProfile ? videoResolution : requestedVquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode,
        videoParameters: node?.metadata?.videoParameters || config.videoParameters || defaultConfig.videoParameters,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || defaultConfig.canvasImageCount : config.count) || defaultConfig.count),
    };
}

export function hasResumableVideoTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.videoTaskId) && !node.metadata?.content;
}

export function hasResumableImageTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image &&
        Boolean(node.metadata?.images?.some((image) => image.taskId && image.taskPollUrl && !image.storageKey));
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.metadata?.status !== "loading") return node;
        if (hasResumableVideoTask(node)) return node;

        if (node.type === CanvasNodeType.Image) {
            const images = node.metadata.images?.map((image) => (
                image.status === "loading" && (!image.taskId || !image.taskPollUrl)
                    ? { ...image, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") }
                    : image
            ));
            const canResume = images?.some((image) => image.status === "loading" && image.taskId && image.taskPollUrl) || false;
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    status: canResume ? "loading" as const : "error" as const,
                    errorDetails: canResume ? undefined : i18n.t("canvas.generation.interrupted"),
                    images,
                },
            };
        }

        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "error" as const,
                errorDetails: i18n.t("canvas.generation.interrupted"),
                texts: node.metadata.texts?.map((text) => (text.status === "loading" ? { ...text, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : text)),
            },
        };
    });
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            url: node.metadata.cloudURL || node.metadata.content,
            storageKey: node.metadata.storageKey,
            sourceObjectKey: node.metadata.cloudSourceObjectKey,
            width: node.metadata.naturalWidth,
            height: node.metadata.naturalHeight,
            bytes: node.metadata.bytes,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
