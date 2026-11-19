import { describe, expect, it } from "vitest";

import { matchingFailedTaskLogIds } from "@/lib/workbench-failed-task-deletion";

describe("matchingFailedTaskLogIds", () => {
    const logs = [
        { id: "failed-a", prompt: "same prompt", error: "same error" },
        { id: "failed-b", prompt: "same prompt", error: "same error" },
    ];

    it("deletes only the failed task selected by logId when several failures share the same prompt and error", () => {
        expect(matchingFailedTaskLogIds(logs, { id: "live-result-a", logId: "failed-a" })).toEqual(["failed-a"]);
    });

    it("supports a live result whose id is also its persisted log id", () => {
        expect(matchingFailedTaskLogIds(logs, { id: "failed-b" })).toEqual(["failed-b"]);
    });

    it("supports a history result whose display id is prefixed but whose logId is exact", () => {
        expect(matchingFailedTaskLogIds(logs, { id: "history-failed:failed-b", logId: "failed-b" })).toEqual(["failed-b"]);
    });
});
