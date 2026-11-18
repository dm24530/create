import { describe, expect, it } from "vitest";

import {
    CANVAS_IMAGE_REQUEST_BUDGET_BYTES,
    CANVAS_IMAGE_REQUEST_POLICIES,
} from "../image-thumbnail";

describe("canvas image request policy", () => {
    it("stays within the async image gateway transport limits", () => {
        expect(CANVAS_IMAGE_REQUEST_BUDGET_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
        expect(Math.max(...CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.maxEdge))).toBeLessThanOrEqual(1600);
        expect(Math.max(...CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.targetBytes))).toBeLessThanOrEqual(480 * 1024);
    });
});
