import type { VideoGenerationTask } from "@/services/api/video";

export const VIDEO_TASK_POLL_INTERVAL_MS = 2_500;
export const VIDEO_TASK_POLL_TIMEOUT_MS = 45 * 60_000;
export const VIDEO_TASK_CONTENT_TIMEOUT_MS = 5 * 60_000;

type ResumeCandidate = {
    logId?: string;
    task?: VideoGenerationTask;
};

export function canResumeVideoTask(result: ResumeCandidate): boolean {
    return Boolean(result.logId?.trim() && result.task?.id?.trim());
}
export function appendVideoBatch<T extends { id: string }>(current: T[], batch: T[]): T[] {
    return [...current, ...batch];
}

export function mergeVideoBatch<T extends { id: string }>(current: T[], batch: T[]): T[] {
    const updates = new Map(batch.map((item) => [item.id, item]));
    return current.map((item) => updates.get(item.id) || item);
}
