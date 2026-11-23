import { describe, expect, it, vi } from "vitest";

import { imageFilesFromClipboardData } from "@/lib/product-detail/clipboard-images";

describe("product detail clipboard images", () => {
    it("extracts image files from clipboard items and ignores text or duplicates", () => {
        const image = new File(["image"], "pasted.png", { type: "image/png" });
        const getAsFile = vi.fn(() => image);
        const data = {
            items: [
                { kind: "string", type: "text/plain" },
                { kind: "file", type: "image/png", getAsFile },
                { kind: "file", type: "image/png", getAsFile },
            ],
            files: [],
        };

        expect(imageFilesFromClipboardData(data)).toEqual([image]);
        expect(getAsFile).toHaveBeenCalledTimes(2);
    });

    it("falls back to clipboard files when item APIs are unavailable", () => {
        const image = new File(["image"], "drop.jpg", { type: "image/jpeg" });
        expect(imageFilesFromClipboardData({ files: [image] })).toEqual([image]);
    });
});