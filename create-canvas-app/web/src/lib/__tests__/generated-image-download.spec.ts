import { describe, expect, it, vi } from "vitest";

import { resolveGeneratedImageBlob } from "../generated-image-download";

describe("generated image download", () => {
    it("prefers the original stored image when a storage key exists", async () => {
        const stored = new Blob(["stored"], { type: "image/png" });
        const getStoredImage = vi.fn().mockResolvedValue(stored);
        const fetchImage = vi.fn();

        await expect(resolveGeneratedImageBlob({ dataUrl: "blob:preview", storageKey: "image:1", mimeType: "image/png" }, { getStoredImage, fetchImage })).resolves.toBe(stored);
        expect(getStoredImage).toHaveBeenCalledWith("image:1");
        expect(fetchImage).not.toHaveBeenCalled();
    });

    it("falls back to the image URL when the stored image is missing", async () => {
        const fetched = new Blob(["remote"], { type: "image/jpeg" });
        const getStoredImage = vi.fn().mockResolvedValue(null);
        const fetchImage = vi.fn().mockResolvedValue(fetched);

        await expect(resolveGeneratedImageBlob({ dataUrl: "https://example.com/image.jpg", storageKey: "image:missing" }, { getStoredImage, fetchImage })).resolves.toBe(fetched);
        expect(fetchImage).toHaveBeenCalledWith("https://example.com/image.jpg");
    });

    it("fails clearly when no downloadable source exists", async () => {
        await expect(resolveGeneratedImageBlob({ dataUrl: "" }, { getStoredImage: vi.fn(), fetchImage: vi.fn() })).rejects.toThrow("IMAGE_DOWNLOAD_SOURCE_MISSING");
    });
});