import type { CanvasNodeData } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import {
  canvasProjectCloudFingerprint,
  projectGraphForCloud,
} from "@/lib/canvas/canvas-cloud-content";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import {
  configureCanvasAuth,
  getCanvasAccessToken as getCanvasAccessTokenFromAuth,
  isCanvasAuthReady,
  subscribeCanvasAuth,
} from "@/services/canvas-auth";

import { createApiUrl, createPublicMediaPath, isCreatePublicMediaUrl, resolveCreateServiceUrl } from "@/lib/create-product";

export type CloudCanvasProjectSummary = {
  id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
  node_count?: number;
  connection_count?: number;
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

function isDesktopCanvasRuntime() {
  if (typeof window === "undefined") return false;
  const bridge = (window as Window & { createDesktop?: { isDesktop?: boolean } }).createDesktop;
  return bridge?.isDesktop === true;
}

export function configureCanvasCloud(token?: string) {
  if (isDesktopCanvasRuntime()) return;
  configureCanvasAuth(token);
}

export function getCanvasAccessToken() {
  return getCanvasAccessTokenFromAuth();
}

export function subscribeCanvasCloud(listener: () => void) {
  return subscribeCanvasAuth(listener);
}

export function isCanvasCloudReady() {
  return !isDesktopCanvasRuntime() && isCanvasAuthReady();
}

async function cloudRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (isDesktopCanvasRuntime()) throw new Error("Canvas cloud storage is disabled in the desktop app");
  const accessToken = getCanvasAccessTokenFromAuth();
  if (!accessToken) throw new Error("Canvas cloud session is unavailable");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(createApiUrl(`/canvas${path}`), {
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
  const limit = 100;
  const projects: CloudCanvasProjectSummary[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await cloudRequest<CloudCanvasProjectSummary[]>(
      `/projects?limit=${limit}&offset=${offset}`,
    );
    projects.push(...page);
    if (page.length < limit) return projects;
  }
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

export async function deleteCloudCanvasProject(id: string) {
  try {
    await cloudRequest(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    if ((error as Error & { status?: number })?.status === 404) return;
    throw error;
  }
}

export { canvasProjectCloudFingerprint, projectGraphForCloud };

export async function uploadCloudCanvasAsset(input: {
  projectId: string;
  nodeId: string;
  kind: "image" | "video" | "audio";
  file?: Blob;
  filename: string;
  thumbnail?: Blob;
  width?: number;
  height?: number;
  sourceObjectKey?: string;
}) {
  if (input.sourceObjectKey) return uploadCloudCanvasAssetDirect(input);
  if (!input.file) throw new CanvasDirectUploadError("Canvas upload file is unavailable");
  return uploadCloudCanvasAssetLegacy({ ...input, file: input.file });
}

type CanvasPresignResponse = {
  existing?: CloudCanvasAsset;
  asset_id?: string;
  kind?: "image" | "video" | "audio";
  object_key?: string;
  upload_url?: string;
  upload_headers?: Record<string, string>;
  thumb_object_key?: string;
  thumb_upload_url?: string;
  thumb_upload_headers?: Record<string, string>;
  thumbnail_content_type?: string;
};

class CanvasDirectUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasDirectUploadError";
  }
}

class CanvasObjectUploadError extends CanvasDirectUploadError {
  constructor(message: string) {
    super(message);
    this.name = "CanvasObjectUploadError";
  }
}

class CanvasPromotionError extends CanvasDirectUploadError {
  constructor(message: string) {
    super(message);
    this.name = "CanvasPromotionError";
  }
}

async function uploadCloudCanvasAssetDirect(input: {
  projectId: string;
  nodeId: string;
  kind: "image" | "video" | "audio";
  file?: Blob;
  filename: string;
  thumbnail?: Blob;
  width?: number;
  height?: number;
  sourceObjectKey?: string;
}) {
  if (input.sourceObjectKey) {
    try {
      return await cloudRequest<CloudCanvasAsset>("/assets/promote", {
        method: "POST",
        body: JSON.stringify({
          project_id: input.projectId,
          node_id: input.nodeId,
          kind: input.kind,
          source_object_key: input.sourceObjectKey,
          width: input.width || 0,
          height: input.height || 0,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Canvas source promotion failed";
      throw new CanvasPromotionError(message);
    }
  }
  if (!input.file) throw new CanvasDirectUploadError("Canvas direct upload file is unavailable");
  const contentType = resolveCanvasContentType(input.file.type, input.filename);
  if (!/^(image|video|audio)\//i.test(contentType)) {
    throw new CanvasDirectUploadError("Canvas direct upload requires a supported media content type");
  }
  const thumbnailContentType = input.thumbnail ? resolveCanvasContentType(input.thumbnail.type, "thumbnail.webp") : "";
  const sha256 = await sha256Blob(input.file).catch(() => "");
  const presign = await cloudRequest<CanvasPresignResponse>("/assets/presign", {
    method: "POST",
    body: JSON.stringify({
      project_id: input.projectId,
      node_id: input.nodeId,
      kind: input.kind,
      filename: input.filename,
      content_type: contentType,
      bytes: input.file.size,
      ...(input.thumbnail ? {
        thumbnail_content_type: thumbnailContentType,
        thumbnail_bytes: input.thumbnail.size,
      } : {}),
      ...(sha256 ? { sha256 } : {}),
    }),
  });
  if (presign.existing) return presign.existing;
  if (!presign.asset_id || !presign.object_key || !presign.upload_url) {
    throw new CanvasDirectUploadError("Canvas direct upload presign response is incomplete");
  }

  await putCanvasObject(presign.upload_url, presign.upload_headers, input.file);
  if (input.thumbnail) {
    if (!presign.thumb_object_key || !presign.thumb_upload_url) {
      throw new CanvasDirectUploadError("Canvas thumbnail direct upload presign response is incomplete");
    }
    await putCanvasObject(presign.thumb_upload_url, presign.thumb_upload_headers, input.thumbnail);
  }

  return cloudRequest<CloudCanvasAsset>("/assets/complete", {
    method: "POST",
    body: JSON.stringify({
      asset_id: presign.asset_id,
      project_id: input.projectId,
      node_id: input.nodeId,
      kind: input.kind,
      filename: input.filename,
      content_type: contentType,
      bytes: input.file.size,
      object_key: presign.object_key,
      ...(input.thumbnail ? {
        thumbnail_content_type: presign.thumbnail_content_type || thumbnailContentType,
        thumbnail_bytes: input.thumbnail.size,
        thumb_object_key: presign.thumb_object_key,
      } : {}),
      width: input.width || 0,
      height: input.height || 0,
      ...(sha256 ? { sha256 } : {}),
    }),
  });
}

async function uploadCloudCanvasAssetLegacy(input: {
  projectId: string;
  nodeId: string;
  kind: "image" | "video" | "audio";
  file: Blob;
  filename: string;
  thumbnail?: Blob;
  width?: number;
  height?: number;
  sourceObjectKey?: string;
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

async function putCanvasObject(url: string, headers: Record<string, string> | undefined, blob: Blob) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers,
      body: blob,
      cache: "no-store",
      credentials: "omit",
    });
  } catch (error) {
    throw new CanvasObjectUploadError(error instanceof Error ? error.message : "Canvas direct upload failed");
  }
  if (!response.ok) {
    throw new CanvasObjectUploadError(`Canvas direct upload failed: ${response.status}`);
  }
}

function shouldFallbackCanvasDirectUpload(error: unknown) {
  if (error instanceof CanvasPromotionError || error instanceof CanvasObjectUploadError) return true;
  if (error instanceof CanvasDirectUploadError) return false;
  const status = (error as { status?: number } | null)?.status;
  return status === 404 || status === 405 || status === 501;
}

function resolveCanvasContentType(value: string, filename: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized) return normalized;
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const byExtension: Record<string, string> = {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    ogg: "audio/ogg",
    png: "image/png",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
  };
  return byExtension[extension] || "application/octet-stream";
}

async function sha256Blob(blob: Blob) {
  if (!globalThis.crypto?.subtle || blob.size > 32 * 1024 * 1024) return "";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function uploadCloudCanvasAssetFromURL(input: {
  projectId: string;
  nodeId: string;
  kind: "image" | "video" | "audio";
  sourceUrl: string;
  width?: number;
  height?: number;
}) {
  const sourceUrl = createPublicMediaPath(input.sourceUrl);
  if (!sourceUrl) {
    throw new Error("Canvas source URL must be a Create media path");
  }
  const form = new FormData();
  form.append("project_id", input.projectId);
  form.append("node_id", input.nodeId);
  form.append("kind", input.kind);
  form.append("source_url", sourceUrl);
  form.append("width", String(input.width || 0));
  form.append("height", String(input.height || 0));
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
  const isRemoteURL = (value?: string) => isCreatePublicMediaUrl(value);
  for (const node of nodes) {
    const metadata = node.metadata;
    if (!metadata) continue;
    const hasImageEntries = Boolean(metadata.images?.length);
    if (node.type === CanvasNodeType.Image && !hasImageEntries && !metadata.cloudAssetId && (metadata.storageKey || metadata.cloudSourceObjectKey || isRemoteURL(metadata.content))) {
      tasks.push(async () => {
        const blob = metadata.storageKey ? await getImageBlob(metadata.storageKey) : undefined;
        const asset = metadata.cloudSourceObjectKey
          ? await uploadCloudCanvasAsset({
              projectId,
              nodeId: node.id,
              kind: "image",
              file: blob || undefined,
              filename: canvasFilename(node.id, blob || new Blob([], { type: "image/png" })),
              width: metadata.naturalWidth,
              height: metadata.naturalHeight,
              sourceObjectKey: metadata.cloudSourceObjectKey,
            })
          : blob
          ? await uploadCloudCanvasAsset({
              projectId,
              nodeId: node.id,
              kind: "image",
              file: blob || undefined,
              filename: canvasFilename(node.id, blob),
              thumbnail: await createImageThumbnail(blob).catch(() => undefined),
              width: metadata.naturalWidth,
              height: metadata.naturalHeight,
            })
          : await uploadCloudCanvasAssetFromURL({
              projectId,
              nodeId: node.id,
              kind: "image",
              sourceUrl: metadata.content || "",
              width: metadata.naturalWidth,
              height: metadata.naturalHeight,
            });
        if (!asset) return;
        onUploaded({ nodeId: node.id, asset });
      });
    }
    for (const image of metadata.images || []) {
      if (image.cloudAssetId || (!image.storageKey && !image.cloudSourceObjectKey && !isRemoteURL(image.content))) continue;
      const imageID = image.id;
      tasks.push(async () => {
        const blob = image.storageKey ? await getImageBlob(image.storageKey) : undefined;
        const asset = image.cloudSourceObjectKey
          ? await uploadCloudCanvasAsset({
              projectId,
              nodeId: node.id,
              kind: "image",
              file: blob || undefined,
              filename: canvasFilename(imageID, blob || new Blob([], { type: "image/png" })),
              width: image.naturalWidth,
              height: image.naturalHeight,
              sourceObjectKey: image.cloudSourceObjectKey,
            })
          : blob
          ? await uploadCloudCanvasAsset({
              projectId,
              nodeId: node.id,
              kind: "image",
              file: blob,
              filename: canvasFilename(imageID, blob),
              thumbnail: await createImageThumbnail(blob).catch(() => undefined),
              width: image.naturalWidth,
              height: image.naturalHeight,
            })
          : await uploadCloudCanvasAssetFromURL({
              projectId,
              nodeId: node.id,
              kind: "image",
              sourceUrl: image.content || "",
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
        if (!asset) return;
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
  const project = hydrateCloudProjectState(record);
  return {
    ...project,
    cloudSyncedFingerprint: canvasProjectCloudFingerprint(project),
  };
}

function hydrateCloudProjectState(record: CloudCanvasProject): CanvasProject {
  const graph = record.graph || {};
  const assetMap = new Map(record.assets.map((asset) => [asset.id, asset]));
  const assetsByNode = new Map<string, CloudCanvasAsset[]>();
  for (const asset of record.assets) {
    if (!asset.node_id) continue;
    const items = assetsByNode.get(asset.node_id) || [];
    items.push(asset);
    assetsByNode.set(asset.node_id, items);
  }
  const nodes = hydrateCloudNodes(graph.nodes || [], assetMap, assetsByNode);
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
    nodeCount: nodes.length,
    connectionCount: (graph.connections || []).length,
    cloudVersion: record.version,
  };
}

export function cloudCanvasProjectFingerprint(project: CloudCanvasProject) {
  return canvasProjectCloudFingerprint(hydrateCloudProjectState(project));
}

function hydrateCloudNodes(
  nodes: CanvasNodeData[],
  assets: Map<string, CloudCanvasAsset>,
  assetsByNode: Map<string, CloudCanvasAsset[]>,
) {
  return nodes.map((node) => {
    const nodeAssets = assetsByNode.get(node.id) || [];
    const hydratedImages = node.metadata?.images?.map((image, index) => {
      const asset = (image.cloudAssetId ? assets.get(image.cloudAssetId) : undefined)
        || nodeAssets[index]
        || (nodeAssets.length === 1 ? nodeAssets[0] : undefined);
      if (!asset) return image;
      const assetURL = resolveCreateServiceUrl(asset.url || "");
      const assetPreviewURL = resolveCreateServiceUrl(asset.thumb_url || asset.url || "");
      const previewURL = assetPreviewURL || image.cloudPreviewURL || image.content;
      const content = assetURL || previewURL || image.content;
      return {
        ...image,
        cloudAssetId: asset.id,
        content,
        cloudURL: assetURL || image.cloudURL,
        cloudPreviewURL: previewURL,
        cloudSyncState: "uploaded" as const,
      };
    });
    const primaryImage = hydratedImages?.find((image) => image.id === node.metadata?.primaryImageId)
      || hydratedImages?.find((image) => image.cloudAssetId || image.content);
    const cloudAssetId = node.metadata?.cloudAssetId as string | undefined;
    const asset = (cloudAssetId ? assets.get(cloudAssetId) : undefined)
      || nodeAssets[0];
    if (!asset && !primaryImage) return { ...node, metadata: { ...node.metadata, images: hydratedImages } };
    const resolvedAsset = asset || (primaryImage?.cloudAssetId ? assets.get(primaryImage.cloudAssetId) : undefined);
    const resolvedAssetURL = resolveCreateServiceUrl(resolvedAsset?.url || "");
    const resolvedThumbURL = resolveCreateServiceUrl(resolvedAsset?.thumb_url || "");
    const previewURL = primaryImage?.cloudPreviewURL || resolvedThumbURL || resolvedAssetURL || "";
    const fullURL = primaryImage?.cloudURL || primaryImage?.content || resolvedAssetURL || node.metadata?.content || "";
    return {
      ...node,
      metadata: {
        ...node.metadata,
        content: fullURL,
        cloudAssetId: resolvedAsset?.id || cloudAssetId,
        cloudURL: primaryImage?.cloudURL || resolvedAssetURL,
        cloudPreviewURL: previewURL,
        mimeType: resolvedAsset?.mime_type || node.metadata?.mimeType,
        bytes: resolvedAsset?.bytes || node.metadata?.bytes,
        cloudSyncState: resolvedAsset ? "uploaded" as const : node.metadata?.cloudSyncState,
        images: hydratedImages,
      },
    };
  });
}




