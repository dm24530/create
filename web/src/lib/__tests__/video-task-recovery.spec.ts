import { describe, expect, it } from "vitest";

import { appendVideoBatch, canResumeVideoTask, mergeVideoBatch, VIDEO_TASK_CONTENT_TIMEOUT_MS, VIDEO_TASK_POLL_TIMEOUT_MS } from "@/lib/video-task-recovery";

describe("video task recovery", () => {
    it("allows Slow video providers at least forty-five minutes to finish", () => {
        expect(VIDEO_TASK_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(45 * 60_000);
        expect(VIDEO_TASK_CONTENT_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000);
    });

    it("resumes an existing task instead of paying for a new generation", () => {
        expect(canResumeVideoTask({
            logId: "log-1",
            task: { id: "task-1", provider: "openai", model: "seedance-2.0" },
        })).toBe(true);
    });

    it("regenerates only when no reusable task exists", () => {
        expect(canResumeVideoTask({ logId: "log-1" })).toBe(false);
        expect(canResumeVideoTask({ task: { id: "", provider: "openai", model: "seedance-2.0" } })).toBe(false);
    });
    it("keeps an earlier running batch when another generation starts", () => {
        const current = [{ id: "task-a", status: "pending" }];
        const next = appendVideoBatch(current, [{ id: "task-b", status: "pending" }]);
        expect(next.map((item) => item.id)).toEqual(["task-a", "task-b"]);
    });

    it("updates only the submitted batch without removing other running tasks", () => {
        const current = [{ id: "task-a", status: "pending" }, { id: "task-b", status: "pending" }];
        const next = mergeVideoBatch(current, [{ id: "task-b", status: "success" }]);
        expect(next).toEqual([{ id: "task-a", status: "pending" }, { id: "task-b", status: "success" }]);
    });
});
