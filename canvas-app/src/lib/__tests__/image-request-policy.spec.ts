import { describe, expect, it } from "vitest";

import {
    CANVAS_IMAGE_REQUEST_BUDGET_BYTES,
    CANVAS_IMAGE_REQUEST_POLICIES,
} from "../image-thumbnail";

describe("canvas image request policy", () => {
    it("keeps reference uploads small enough for slow tunnels", () => {
        expect(CANVAS_IMAGE_REQUEST_BUDGET_BYTES).toBeLessThanOrEqual(1.5 * 1024 * 1024);
        expect(Math.max(...CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.maxEdge))).toBeLessThanOrEqual(1536);
        expect(Math.max(...CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.targetBytes))).toBeLessThanOrEqual(750 * 1024);
    });
});
