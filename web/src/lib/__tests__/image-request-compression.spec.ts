import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_IMAGE_REQUEST_POLICIES, createImageRequestBlob } from "../image-thumbnail";

describe("image request compression", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("keeps reducing quality and dimensions until the upload target is met", async () => {
        const bitmap = { width: 4000, height: 3000, close: vi.fn() };
        vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));

        const drawImage = vi.fn();
        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ({ drawImage })),
            toBlob: vi.fn((callback: BlobCallback, _type?: string, quality?: number) => {
                const size = Math.round(canvas.width * canvas.height * (quality || 0.7) * 0.55);
                callback(new Blob([new Uint8Array(size)], { type: "image/webp" }));
            }),
        } as unknown as HTMLCanvasElement;
        vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
            if (tagName === "canvas") return canvas;
            return document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
        });

        const result = await createImageRequestBlob(
            new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/png" }),
            CANVAS_IMAGE_REQUEST_POLICIES[0],
        );

        expect(result.blob.size).toBeLessThanOrEqual(CANVAS_IMAGE_REQUEST_POLICIES[0].targetBytes);
        expect(result.width).toBeLessThanOrEqual(CANVAS_IMAGE_REQUEST_POLICIES[0].maxEdge);
        expect(result.height).toBeLessThanOrEqual(CANVAS_IMAGE_REQUEST_POLICIES[0].maxEdge);
        expect(drawImage).toHaveBeenCalled();
        expect(bitmap.close).toHaveBeenCalled();
    });
});