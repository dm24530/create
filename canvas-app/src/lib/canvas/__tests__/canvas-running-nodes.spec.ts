import { describe, expect, it } from "vitest";

import { addRunningNodeId, removeRunningNodeId, removeRunningNodeIds } from "../canvas-running-nodes";

describe("canvas running nodes", () => {
    it("keeps earlier nodes running when another generation starts", () => {
        let running = addRunningNodeId(new Set<string>(), "config-a");
        running = addRunningNodeId(running, "config-b");

        expect([...running]).toEqual(["config-a", "config-b"]);
        expect([...removeRunningNodeId(running, "config-b")]).toEqual(["config-a"]);
    });

    it("removes only deleted nodes from the running set", () => {
        const running = new Set(["config-a", "config-b", "config-c"]);
        const deleted = new Set(["config-b"]);

        expect([...removeRunningNodeIds(running, deleted)]).toEqual(["config-a", "config-c"]);
    });
});
