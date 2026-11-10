import { describe, expect, it, vi } from "vitest";

import { prepareCanvasReferenceImagesForRequest } from "../canvas-generation-helpers";
import type { ReferenceImage } from "@/types/image";

vi.mock("@/services/image-storage", () => ({
    claimLegacyStoredImage: vi.fn(),
    ensureImagePreview: vi.fn(),
    getImageBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
    prepareImageRequestDataUrls: vi.fn(async (images: ReferenceImage[]) => images.map(() => ({
        dataUrl: "data:image/webp;base64,aW1hZ2U=",
        mimeType: "image/webp",
        bytes: 5,
        sourceBytes: 5,
        width: 1024,
        height: 1024,
        reencoded: true,
        policy: 0,
    }))),
    resolveImageUrl: vi.fn(),
    uploadImage: vi.fn(),
}));

vi.mock("@/services/file-storage", () => ({
    resolveMediaUrl: vi.fn(),
}));

describe("prepareCanvasReferenceImagesForRequest", () => {
    it("returns locally compressed data URLs without uploading to R2 first", async () => {
        const reference = (index: number): ReferenceImage => ({
            id: `node-${index}`,
            name: "shared.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,aW1hZ2U=",
            storageKey: "image:shared",
        });

        const results = await prepareCanvasReferenceImagesForRequest("project-dedupe", [reference(0)]);

        expect(results[0]).toMatchObject({
            dataUrl: "data:image/webp;base64,aW1hZ2U=",
            type: "image/webp",
            storageKey: undefined,
            url: undefined,
        });
    });
});
