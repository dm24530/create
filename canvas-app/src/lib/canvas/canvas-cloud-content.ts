import type { CanvasNodeData, CanvasNodeTypeId } from "../../types/canvas";
import { CanvasNodeType } from "../../types/canvas";
import type { CanvasProject } from "../../stores/canvas/use-canvas-store";
import { hashCanvasGraph, stableCanvasGraph } from "./canvas-cloud-fingerprint";

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
      cloudSourceObjectKey: undefined,
      images: metadata.images?.map((image) => ({
        ...image,
        cloudSourceObjectKey: undefined,
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
