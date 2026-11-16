import type { CanvasNodeData, CanvasNodeTypeId } from "../../types/canvas";
import { CanvasNodeType } from "../../types/canvas";
import type { CanvasProject } from "../../stores/canvas/use-canvas-store";
import { hashCanvasGraph, stableCanvasGraph } from "./canvas-cloud-fingerprint";
import { cloudCanvasMediaSource } from "./canvas-media-url";

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

export function canvasProjectCloudFingerprint(project: CanvasProject) {
  return hashCanvasGraph(stableCanvasGraph({
    title: project.title,
    graph: projectGraphForCloud(project),
  }));
}

function sanitizeNodeForCloud(node: CanvasNodeData): CanvasNodeData {
  if (!isMediaNode(node.type)) return node;
  const metadata = node.metadata || {};
  const cloudURL = cloudCanvasMediaSource(metadata.cloudURL);
  const cloudPreviewURL = cloudCanvasMediaSource(metadata.cloudPreviewURL);
  const content = cloudPreviewURL || cloudURL || (
    cloudCanvasMediaSource(metadata.content)
  );
  return {
    ...node,
    metadata: {
      ...metadata,
      content,
      cloudSourceObjectKey: undefined,
      images: metadata.images?.map((image) => ({
        ...image,
        cloudSourceObjectKey: undefined,
        content: cloudCanvasMediaSource(image.cloudPreviewURL) ||
          cloudCanvasMediaSource(image.cloudURL) ||
          cloudCanvasMediaSource(image.content),
      })),
    },
  };
}

function isMediaNode(type: CanvasNodeTypeId) {
  return type === CanvasNodeType.Image || type === CanvasNodeType.Video || type === CanvasNodeType.Audio;
}
