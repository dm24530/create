import { getCanvasAccessToken } from "@/services/canvas-auth";
import { createApiUrl } from "@/lib/create-product";

const reportedTaskIds = new Set<string>();

export function reportCanvasImageDisplay(
    taskId: string | undefined,
    startedAt: number | undefined,
    now = Date.now(),
) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId || reportedTaskIds.has(normalizedTaskId)) return;

    const accessToken = getCanvasAccessToken();
    if (!accessToken) return;

    const start = Number(startedAt || 0);
    const durationMs = start > 0 ? Math.max(1, Math.floor(now - start)) : undefined;
    reportedTaskIds.add(normalizedTaskId);

    void fetch(createApiUrl("/usage/image-display"), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            task_id: normalizedTaskId,
            duration_ms: durationMs,
        }),
    }).then((response) => {
        if (!response.ok) throw new Error(`Image display report failed: ${response.status}`);
    }).catch(() => {
        reportedTaskIds.delete(normalizedTaskId);
    });
}

