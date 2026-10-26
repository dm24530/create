import type { CanvasNodeData, CanvasNodeTypeId } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";

export type CloudCanvasProjectSummary = {
  id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CloudCanvasAsset = {
  id: string;
  project_id: string;
  node_id: string;
  kind: "image" | "video" | "audio";
  url: string;
  thumb_url?: string;
  width: number;
  height: number;
  bytes: number;
  mime_type: string;
  sha256?: string;
  created_at: string;
};

export type CloudCanvasProject = CloudCanvasProjectSummary & {
  graph: Partial<CanvasProject>;
  assets: CloudCanvasAsset[];
};

let accessToken = "";
const listeners = new Set<() => void>();

export function configureCanvasCloud(token?: string) {
  accessToken = token?.trim() || "";
  listeners.forEach((listener) => listener());
}

export function getCanvasAccessToken() {
  return accessToken;
}

export function subscribeCanvasCloud(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isCanvasCloudReady() {
  return Boolean(accessToken);
}

async function cloudRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!accessToken) throw new Error("Canvas cloud session is unavailable");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api/v1/canvas${path}`, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => null) as { data?: T; message?: string } | null;
  if (!response.ok) {
    const error = new Error(payload?.message || `Canvas cloud request failed: ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload?.data as T;
}

export async function listCloudCanvasProjects() {
  return cloudRequest<CloudCanvasProjectSummary[]>("/projects");
}

export async function listCloudCanvasProjectsFull() {
  const limit = 100;
  const projects: CloudCanvasProject[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await cloudRequest<CloudCanvasProject[]>(
      `/projects/full?limit=${limit}&offset=${offset}`,
    );
    projects.push(...page);
    if (page.length < limit) return projects;
  }
}

export async function getCloudCanvasProject(id: string) {
  return cloudRequest<CloudCanvasProject>(`/projects/${encodeURIComponent(id)}`);
}

export async function putCloudCanvasProject(project: CanvasProject) {
  return cloudRequest<{ id: string; version: number; updated_at?: string }>(
    `/projects/${encodeURIComponent(project.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        title: project.title,
        graph: projectGraphForCloud(project),
        version: project.cloudVersion || 0,
      }),
    },
  );
}

export function putCloudCanvasProjectKeepalive(project: CanvasProject) {
  if (!accessToken) return;
  const body = JSON.stringify({
    title: project.title,
    graph: projectGraphForCloud(project),
    version: project.cloudVersion || 0,
  });
  // The Fetch keepalive body limit is 64 KiB. Large canvases must use a
  // regular request so the browser is not guaranteed to reject the flush.
  if (new Blob([body]).size > 60 * 1024) {
    void putCloudCanvasProject(project).catch(() => undefined);
    return;
  }
  void fetch(`/api/v1/canvas/projects/${encodeURIComponent(project.id)}`, {
    method: "PUT",
    keepalive: true,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body,
  }).catch(() => undefined);
}

export async function deleteCloudCanvasProject(id: string) {
  await cloudRequest(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadCloudCanvasAsset(input: {
  projectId: string;
  nodeId: string;
  kind: "image" | "video" | "audio";
  file: Blob;
  filename: string;
  thumbnail?: Blob;
  width?: number;
  height?: number;
}) {
  const form = new FormData();
  form.append("project_id", input.projectId);
  form.append("node_id", input.nodeId);
  form.append("kind", input.kind);
  form.append("width", String(input.width || 0));
  form.append("height", String(input.height || 0));
  form.append("file", input.file, input.filename);
  if (input.thumbnail) form.append("thumbnail", input.thumbnail, "thumbnail.jpg");
  return cloudRequest<CloudCanvasAsset>("/assets", {
    method: "POST",
    body: form,
  });
}

export async function deleteCloudCanvasAsset(id: string) {
  await cloudRequest(`/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

type CanvasAssetUploadResult = {
  nodeId: string;
  imageId?: string;
  asset: CloudCanvasAsset;
};

export async function uploadPendingCanvasAssets(
  projectId: string,
  nodes: CanvasNodeData[],
  onUploaded: (result: CanvasAssetUploadResult) => void,
) {
  const tasks: Array<() => Promise<void>> = [];
  for (const node of nodes) {
    const metadata = node.metadata;
    if (node.type === CanvasNodeType.Image && metadata?.storageKey && !metadata.cloudAssetId) {
      tasks.push(async () => {
        const blob = await getImageBlob(metadata.storageKey!);
        if (!blob) return;
        const thumbnail = await createImageThumbnail(blob).catch(() => undefined);
        const asset = await uploadCloudCanvasAsset({
          projectId,
          nodeId: node.id,
          kind: "image",
          file: blob,
          filename: canvasFilename(node.id, blob),
          thumbnail,
          width: metadata.naturalWidth,
          height: metadata.naturalHeight,
        });
        onUploaded({ nodeId: node.id, asset });
      });
    }
    for (const image of metadata?.images || []) {
      if (!image.storageKey || image.cloudAssetId) continue;
      const imageID = image.id;
      tasks.push(async () => {
        const blob = await getImageBlob(image.storageKey!);
        if (!blob) return;
        const thumbnail = await createImageThumbnail(blob).catch(() => undefined);
        const asset = await uploadCloudCanvasAsset({
          projectId,
          nodeId: node.id,
          kind: "image",
          file: blob,
          filename: canvasFilename(imageID, blob),
          thumbnail,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        onUploaded({ nodeId: node.id, imageId: imageID, asset });
      });
    }
    if (
      (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) &&
      metadata?.storageKey &&
      !metadata.cloudAssetId
    ) {
      const kind = node.type === CanvasNodeType.Audio ? "audio" : "video";
      tasks.push(async () => {
        const blob = await getMediaBlob(metadata.storageKey!);
        if (!blob) return;
        const asset = await uploadCloudCanvasAsset({
          projectId,
          nodeId: node.id,
          kind,
          file: blob,
          filename: canvasFilename(node.id, blob, kind === "audio" ? ".mp3" : ".mp4"),
          width: metadata.naturalWidth,
          height: metadata.naturalHeight,
        });
        onUploaded({ nodeId: node.id, asset });
      });
    }
  }

  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, worker));
}

function canvasFilename(id: string, blob: Blob, fallback = ".png") {
  const extensionByMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
  };
  return `${id}${extensionByMime[blob.type] || fallback}`;
}

export function hydrateCloudProject(record: CloudCanvasProject): CanvasProject {
  const graph = record.graph || {};
  const assetMap = new Map(record.assets.map((asset) => [asset.id, asset]));
  const nodes = hydrateCloudNodes(graph.nodes || [], assetMap);
  return {
    id: record.id,
    title: record.title || graph.title || "Untitled",
    createdAt: graph.createdAt || record.created_at,
    updatedAt: graph.updatedAt || record.updated_at,
    nodes,
    connections: graph.connections || [],
    chatSessions: graph.chatSessions || [],
    activeChatId: graph.activeChatId || null,
    backgroundMode: graph.backgroundMode || "lines",
    showImageInfo: Boolean(graph.showImageInfo),
    viewport: graph.viewport || { x: 0, y: 0, k: 1 },
    cloudVersion: record.version,
  };
}

export function projectGraphForCloud(project: CanvasProject) {
  return {
    nodes: project.nodes.map(sanitizeNodeForCloud),
    connections: project.connections,
    chatSessions: project.chatSessions,
    activeChatId: project.activeChatId,
    backgroundMode: project.backgroundMode,
    showImageInfo: project.showImageInfo,
    viewport: project.viewport,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function hydrateCloudNodes(nodes: CanvasNodeData[], assets: Map<string, CloudCanvasAsset>) {
  return nodes.map((node) => {
    const hydratedImages = node.metadata?.images?.map((image) => {
      const asset = image.cloudAssetId ? assets.get(image.cloudAssetId) : undefined;
      if (!asset) return image;
      const previewURL = asset.thumb_url || asset.url;
      return {
        ...image,
        content: asset.url,
        cloudURL: asset.url,
        cloudPreviewURL: previewURL,
        cloudSyncState: "uploaded" as const,
      };
    });
    const primaryImage = hydratedImages?.find((image) => image.id === node.metadata?.primaryImageId)
      || hydratedImages?.find((image) => image.cloudAssetId);
    const cloudAssetId = node.metadata?.cloudAssetId as string | undefined;
    const asset = cloudAssetId ? assets.get(cloudAssetId) : undefined;
    if (!asset && !primaryImage) return { ...node, metadata: { ...node.metadata, images: hydratedImages } };
    const resolvedAsset = asset || (primaryImage?.cloudAssetId ? assets.get(primaryImage.cloudAssetId) : undefined);
    const previewURL = primaryImage?.cloudPreviewURL || resolvedAsset?.thumb_url || resolvedAsset?.url || "";
    const fullURL = primaryImage?.cloudURL || resolvedAsset?.url || node.metadata?.content || "";
    return {
      ...node,
      metadata: {
        ...node.metadata,
        content: fullURL,
        cloudAssetId: resolvedAsset?.id || cloudAssetId,
        cloudURL: primaryImage?.cloudURL || resolvedAsset?.url,
        cloudPreviewURL: previewURL,
        mimeType: resolvedAsset?.mime_type || node.metadata?.mimeType,
        bytes: resolvedAsset?.bytes || node.metadata?.bytes,
        cloudSyncState: resolvedAsset ? "uploaded" as const : node.metadata?.cloudSyncState,
        images: hydratedImages,
      },
    };
  });
}

function sanitizeNodeForCloud(node: CanvasNodeData): CanvasNodeData {
  if (!isMediaNode(node.type)) return node;
  const metadata = node.metadata || {};
  const cloudURL = typeof metadata.cloudURL === "string" ? metadata.cloudURL : "";
  const cloudPreviewURL = typeof metadata.cloudPreviewURL === "string" ? metadata.cloudPreviewURL : "";
  const content = cloudPreviewURL || cloudURL || (
    typeof metadata.content === "string" && !metadata.content.startsWith("blob:") && !metadata.content.startsWith("data:")
      ? metadata.content
      : ""
  );
  return {
    ...node,
    metadata: {
      ...metadata,
      content,
      images: metadata.images?.map((image) => ({
        ...image,
        content: image.cloudPreviewURL || image.cloudURL || (
          !image.content?.startsWith("blob:") && !image.content?.startsWith("data:") ? image.content : ""
        ),
      })),
    },
  };
}

function isMediaNode(type: CanvasNodeTypeId) {
  return type === CanvasNodeType.Image || type === CanvasNodeType.Video || type === CanvasNodeType.Audio;
}
