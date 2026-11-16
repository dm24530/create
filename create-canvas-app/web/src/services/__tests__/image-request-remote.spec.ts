import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareImageRequestDataUrls } from "../image-storage";

describe("remote image references", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("resolves Create media paths without contacting an upstream host", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const prepared = await prepareImageRequestDataUrls([
            { url: "/api/v1/public/canvas-assets/ref/content" },
        ]);

        expect(prepared).toHaveLength(1);
        expect(prepared[0].dataUrl).toBe(`${window.location.origin}/api/v1/public/canvas-assets/ref/content`);
        expect(prepared[0].bytes).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reuses locally compressed data URLs without fetching or recompressing", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const prepared = await prepareImageRequestDataUrls([{
            dataUrl: "data:image/webp;base64,aW1hZ2U=",
            type: "image/webp",
            width: 1024,
            height: 768,
            bytes: 5,
            requestDataUrlPrepared: true,
        }]);

        expect(prepared[0]).toMatchObject({
            dataUrl: "data:image/webp;base64,aW1hZ2U=",
            mimeType: "image/webp",
            width: 1024,
            height: 768,
            policy: -1,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
