import { describe, expect, it } from "vitest";

import { buildImageReferencePromptText } from "../image-reference-prompt";

describe("image reference prompt", () => {
    it("adds the node title after each image number", () => {
        const prompt = buildImageReferencePromptText("小猫放到图1的地上", [
            { id: "room", name: "绘制一个客厅和桌子.png", type: "image/png", dataUrl: "room" },
            { id: "cat", name: "绘制一个小猫.png", type: "image/png", dataUrl: "cat" },
        ]);

        expect(prompt).toContain("图片1（绘制一个客厅和桌子）");
        expect(prompt).toContain("图片2（绘制一个小猫）");
        expect(prompt).toContain("小猫放到图1的地上");
    });
});
