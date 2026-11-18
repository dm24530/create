import { describe, expect, it } from "vitest";

import { canvasAssetFolderName, canvasProjectAssetFolder } from "@/lib/canvas/canvas-asset-folder";

describe("canvas asset folders", () => {
    it("uses the canvas title and a short stable id", () => {
        expect(canvasAssetFolderName("a1b2c3d4e5f6", "城市夜景")).toBe("城市夜景-a1b2c3d4");
    });

    it("removes characters that are invalid in folder names", () => {
        expect(canvasAssetFolderName("a1b2c3d4e5f6", '海报: "夏日"/v1')).toBe("海报-夏日-v1-a1b2c3d4");
    });

    it("preserves an existing project folder across title changes", () => {
        expect(canvasProjectAssetFolder({ id: "a1b2c3d4e5f6", title: "新名称", assetFolder: "旧名称-a1b2c3d4" })).toBe("旧名称-a1b2c3d4");
    });
});
