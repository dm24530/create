import { afterEach, describe, expect, it, vi } from "vitest";

import { saveGeneratedFile } from "../desktop-save";

describe("desktop generated-file save", () => {
    afterEach(() => {
        delete (window as Window & { createDesktop?: unknown }).createDesktop;
    });

    it("sends the original bytes to the configured desktop save bridge", async () => {
        const saveBridge = vi.fn().mockResolvedValue({ savePath: "C:\\images\\image-1.png" });
        Object.assign(window, {
            createDesktop: {
                isDesktop: true,
                getSaveSettings: vi.fn(),
                saveSaveSettings: vi.fn(),
                chooseSaveDirectory: vi.fn(),
                openSaveFolder: vi.fn(),
                saveGeneratedFile: saveBridge,
            },
        });

        const blob = new Blob(["image-bytes"], { type: "image/png" });
        await expect(saveGeneratedFile(blob, "image", "image/png", "image-1.png")).resolves.toBe(true);
        expect(saveBridge).toHaveBeenCalledTimes(1);
        const payload = saveBridge.mock.calls[0][0];
        expect(payload.kind).toBe("image");
        expect(payload.filename).toBe("image-1.png");
        expect(payload.data).toBeInstanceOf(ArrayBuffer);
    });
});