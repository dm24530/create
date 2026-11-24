import { autoSaveGeneratedFile } from "@/lib/desktop-save";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { isCreatePublicMediaUrl } from "@/lib/create-product";
import { getMediaBlob, type UploadedFile } from "@/services/file-storage";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const VIDEO_NODE_MAX_WIDTH = 420;
export const VIDEO_NODE_MAX_HEIGHT = 420;

export async function persistGeneratedCanvasImage(dataUrl: string, canvasFolder: string, signal?: AbortSignal) {
    const uploaded = await uploadImage(dataUrl, { signal });
    try {
        const blob = uploaded.storageKey ? await getImageBlob(uploaded.storageKey) : null;
        if (blob) await autoSaveGeneratedFile(blob, "canvas", uploaded.mimeType || blob.type || "image/png", new Date(), { canvasFolder });
    } catch (error) {
        console.warn("Failed to save generated canvas image to local directory", error);
    }
    return uploaded;
}

export async function persistGeneratedCanvasVideo(video: UploadedFile, canvasFolder: string) {
    try {
        const blob = await getMediaBlob(video.storageKey);
        if (blob) await autoSaveGeneratedFile(blob, "canvas", video.mimeType || blob.type || "video/mp4", new Date(), { canvasFolder });
    } catch (error) {
        console.warn("Failed to save generated canvas video to local directory", error);
    }
    return video;
}

export function applyGeneratedVideo(item: CanvasNodeData, video: UploadedFile, extra: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    const videoSize = fitNodeSize(video.width || item.width, video.height || item.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
    return {
        ...item,
        width: videoSize.width,
        height: videoSize.height,
        position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
        metadata: { ...item.metadata, ...videoMetadata(video), ...extra },
    };
}

export function measureFocusFrame(container: HTMLDivElement | null, nodeId: string): { above?: number; below?: number; bottomInset?: number } {
    if (!container) return {};
    const nodeRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.getBoundingClientRect();
    const panelRect = container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] [data-node-panel]`)?.getBoundingClientRect();
    const toolbarRect = document.querySelector<HTMLElement>(`[data-node-toolbar="${nodeId}"]`)?.getBoundingClientRect();
    const dockRect = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")?.getBoundingClientRect();
    const below = nodeRect && panelRect ? panelRect.bottom - nodeRect.bottom : 0;
    const above = nodeRect && toolbarRect ? nodeRect.top - toolbarRect.top : 0;
    return { above, below, bottomInset: dockRect && below > 0 ? Math.max(0, container.getBoundingClientRect().bottom - dockRect.top) : 0 };
}

export function hasPendingCloudAsset(node: CanvasNodeData) {
    const metadata = node.metadata;
    if (!metadata) return false;
    const mediaNode = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
    const isRemoteURL = (value?: string) => isCreatePublicMediaUrl(value);
    const hasImageEntries = Boolean(metadata.images?.length);
    if (
        mediaNode &&
        (metadata.storageKey || metadata.cloudSourceObjectKey || (node.type === CanvasNodeType.Image && isRemoteURL(metadata.content))) &&
        !(node.type === CanvasNodeType.Image && hasImageEntries) &&
        !metadata.cloudAssetId &&
        metadata.cloudSyncState !== "uploading" &&
        metadata.cloudSyncState !== "failed"
    ) return true;
    return Boolean(metadata.images?.some((image) => (
        (image.storageKey || image.cloudSourceObjectKey || (node.type === CanvasNodeType.Image && isRemoteURL(image.content))) &&
        !image.cloudAssetId &&
        image.cloudSyncState !== "uploading" &&
        image.cloudSyncState !== "failed"
    )));
}

export function canvasNodeImageIsPreviewOnly(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image) return false;
    const primaryImageId = node.metadata?.primaryImageId || node.metadata?.images?.[0]?.id;
    const primaryImage = node.metadata?.images?.find((image) => image.id === primaryImageId);
    return Boolean(primaryImage?.previewOnly || node.metadata?.previewOnly);
}
