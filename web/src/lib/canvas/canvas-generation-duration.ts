import type { CanvasNodeData, CanvasNodeStatus } from "@/types/canvas";

const COMPLETED_STATUSES = new Set<CanvasNodeStatus>(["success", "error"]);

export type CanvasGenerationClock = {
    activeStarts: Map<string, number>;
};

export function createCanvasGenerationClock(): CanvasGenerationClock {
    return { activeStarts: new Map() };
}

/**
 * Records wall-clock generation time after a node has actually been observed loading.
 * The loading marker is kept through preview updates so a preview cannot end the timer early.
 * `metadata.durationMs` is reserved for media playback length and must not be reused.
 */
export function recordCanvasGenerationDurations(nodes: CanvasNodeData[], clock: CanvasGenerationClock, completedAt: number): CanvasNodeData[] {
    const nodeIds = new Set(nodes.map((node) => node.id));
    for (const nodeId of clock.activeStarts.keys()) {
        if (!nodeIds.has(nodeId)) clock.activeStarts.delete(nodeId);
    }

    let changed = false;
    const nextNodes = nodes.map((node) => {
        const metadata = node.metadata;
        const status = metadata?.status;

        if (status === "loading") {
            const startedAt = metadata?.generationStartedAt;
            if (startedAt && startedAt > 0 && Number.isFinite(startedAt)) clock.activeStarts.set(node.id, startedAt);
            if (metadata?.generationDurationMs === undefined) return node;
            changed = true;
            return { ...node, metadata: { ...metadata, generationDurationMs: undefined } };
        }

        if (status === "idle") {
            clock.activeStarts.delete(node.id);
            return node;
        }

        if (!status || !COMPLETED_STATUSES.has(status)) return node;
        const startedAt = clock.activeStarts.get(node.id);
        if (startedAt === undefined) return node;

        // A preview is already successful visually, but the generated file is still being persisted.
        if (status === "success" && metadata?.previewOnly) return node;
        if (!Number.isFinite(completedAt)) return node;

        clock.activeStarts.delete(node.id);
        const generationDurationMs = Math.max(0, Math.round(completedAt - startedAt));
        if (metadata?.generationDurationMs === generationDurationMs) return node;

        changed = true;
        return { ...node, metadata: { ...metadata, generationDurationMs } };
    });

    return changed ? nextNodes : nodes;
}
