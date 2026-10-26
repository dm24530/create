import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

export function buildImageGenerationReferences(
    sourceNode: CanvasNodeData | undefined,
    upstreamReferences: ReferenceImage[],
    overwriteExisting: boolean,
): ReferenceImage[] {
    const sourceReference =
        sourceNode?.type === CanvasNodeType.Image &&
        sourceNode.metadata?.content &&
        !overwriteExisting &&
        upstreamReferences.length === 0
            ? [{
                  id: sourceNode.id,
                  name: `${sourceNode.title || sourceNode.id}.png`,
                  type: sourceNode.metadata.mimeType || "image/png",
                  dataUrl: sourceNode.metadata.content,
                  storageKey: sourceNode.metadata.storageKey,
              }]
            : [];
    return [...new Map([...sourceReference, ...upstreamReferences].map((image) => [image.id, image])).values()];
}
