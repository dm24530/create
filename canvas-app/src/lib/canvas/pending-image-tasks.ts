import type { PersistentImageTask } from "@/services/api/image";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";

const STORAGE_PREFIX = "infinite-canvas:pending-image-tasks:v1";
const TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type PendingImageTaskEntry = {
    projectId: string;
    nodeId: string;
    imageId: string;
    taskId: string;
    pollUrl: string;
    provider: PersistentImageTask["provider"];
    updatedAt: number;
    generationStartedAt?: number;
};

type PendingImageTaskJournal = Record<string, PendingImageTaskEntry>;

function storageKey() {
    if (typeof window === "undefined") return STORAGE_PREFIX;
    const user = new URLSearchParams(window.location.search).get("user")?.trim() || "default";
    return `${STORAGE_PREFIX}:${user}`;
}

function entryKey(nodeId: string, imageId: string) {
    return `${nodeId}:${imageId}`;
}

function readJournal(): PendingImageTaskJournal {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(storageKey()) || "{}") as PendingImageTaskJournal;
        const cutoff = Date.now() - TASK_MAX_AGE_MS;
        return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => entry && typeof entry.taskId === "string" && typeof entry.pollUrl === "string" && Number(entry.updatedAt) >= cutoff));
    } catch {
        return {};
    }
}

function writeJournal(journal: PendingImageTaskJournal) {
    if (typeof window === "undefined") return;
    try {
        if (Object.keys(journal).length === 0) {
            window.localStorage.removeItem(storageKey());
            return;
        }
        window.localStorage.setItem(storageKey(), JSON.stringify(journal));
    } catch {
        // The normal canvas store remains the fallback when localStorage is unavailable.
    }
}

export function rememberPendingImageTask(projectId: string, nodeId: string, imageId: string, task: PersistentImageTask, generationStartedAt?: number) {
    const journal = readJournal();
    journal[entryKey(nodeId, imageId)] = {
        projectId,
        nodeId,
        imageId,
        taskId: task.taskId,
        pollUrl: task.pollUrl,
        provider: task.provider,
        updatedAt: Date.now(),
        generationStartedAt,
    };
    writeJournal(journal);
}

export function clearPendingImageTask(projectId: string, nodeId: string, imageId: string) {
    const journal = readJournal();
    const key = entryKey(nodeId, imageId);
    if (journal[key]?.projectId !== projectId) return;
    delete journal[key];
    writeJournal(journal);
}

export function clearPendingImageTasksForNodes(projectId: string, nodeIds: Iterable<string>) {
    const ids = new Set(nodeIds);
    if (!ids.size) return;
    const journal = readJournal();
    let changed = false;
    for (const [key, entry] of Object.entries(journal)) {
        if (entry.projectId === projectId && ids.has(entry.nodeId)) {
            delete journal[key];
            changed = true;
        }
    }
    if (changed) writeJournal(journal);
}

export function applyPendingImageTasks(projectId: string, nodes: CanvasNodeData[]) {
    const entries = Object.values(readJournal()).filter((entry) => entry.projectId === projectId);
    if (!entries.length) return nodes;

    const byNode = new Map<string, PendingImageTaskEntry[]>();
    entries.forEach((entry) => {
        const list = byNode.get(entry.nodeId) || [];
        list.push(entry);
        byNode.set(entry.nodeId, list);
    });

    return nodes.map((node) => {
        const pending = byNode.get(node.id);
        if (!pending?.length || node.type !== CanvasNodeType.Image) return node;

        const images = [...(node.metadata?.images || [])];
        for (const entry of pending) {
            const index = images.findIndex((image) => image.id === entry.imageId);
            const resumedImage: CanvasNodeImage = {
                ...(index >= 0
                    ? images[index]
                    : {
                          id: entry.imageId,
                          content: "",
                          naturalWidth: 0,
                          naturalHeight: 0,
                          bytes: 0,
                          mimeType: "",
                      }),
                status: "loading",
                taskId: entry.taskId,
                taskPollUrl: entry.pollUrl,
                taskProvider: entry.provider,
                errorDetails: undefined,
            };
            if (index >= 0) images[index] = resumedImage;
            else images.push(resumedImage);
        }

        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "loading" as const,
                errorDetails: undefined,
                generationStartedAt: node.metadata?.generationStartedAt || pending[0].generationStartedAt,
                images,
                primaryImageId: node.metadata?.primaryImageId,
            },
        };
    });
}
