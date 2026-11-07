import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareImageRequestDataUrls } from "../image-storage";

describe("remote image references", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("keeps public image URLs out of the browser upload body", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const prepared = await prepareImageRequestDataUrls([
            { url: "https://cdn.example.test/reference.png" },
        ]);

        expect(prepared).toHaveLength(1);
        expect(prepared[0].dataUrl).toBe("https://cdn.example.test/reference.png");
        expect(prepared[0].bytes).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
