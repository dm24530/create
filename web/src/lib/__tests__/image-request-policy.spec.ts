import { describe, expect, it } from "vitest";

import {
    CANVAS_IMAGE_REQUEST_BUDGET_BYTES,
    CANVAS_IMAGE_REQUEST_POLICIES,
} from "../image-thumbnail";

describe("canvas image request policy", () => {
    it("matches the web high-resolution reference policy", () => {
        expect(CANVAS_IMAGE_REQUEST_BUDGET_BYTES).toBe(10 * 1024 * 1024);
        expect(CANVAS_IMAGE_REQUEST_POLICIES[0]).toMatchObject({
            maxEdge: 2048,
            quality: 0.88,
            targetBytes: 1024 * 1024,
        });
        expect(CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.maxEdge)).toEqual([2048, 1600, 1280, 1024, 768, 640]);
        expect(Math.max(...CANVAS_IMAGE_REQUEST_POLICIES.map((policy) => policy.targetBytes))).toBe(1024 * 1024);
    });
});