import { describe, expect, it } from "vitest";

import {
    CANVAS_IMAGE_REQUEST_BUDGET_BYTES,
    CANVAS_IMAGE_REQUEST_POLICIES,
} from "../image-thumbnail";

describe("canvas image request policy", () => {
    it("stays within the async image gateway transport limits", () => {
        expect(CANVAS_IMAGE_REQUEST_BUDGET_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(Math.max(...CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.maxEdge))).toBeLessThanOrEqual(2048);
        expect(Math.max(...CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.targetBytes))).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    });
});
