import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { resolveProductDetailImageModel, resolveProductDetailTextModel } from "@/lib/product-detail/models";
import { defaultConfig } from "@/stores/use-config-store";
import type { ProductDetailProject } from "@/types/product-detail";

const baseProject: ProductDetailProject = {
    id: "p1", userId: 1, name: "测试", status: "discovery", platform: "taobao", brief: createEmptyBrief("taobao"),
    skillIds: [], conversationId: "c1", messages: [], pageSpecs: [], assets: [], createdAt: 1, updatedAt: 1,
};

describe("product detail model selection", () => {
    it("uses the project model without changing the global workbench model", () => {
        const config = { ...defaultConfig, textModel: "global-text", imageModel: "global-image" };
        const project = { ...baseProject, textModel: "project-text", imageModel: "project-image" };
        expect(resolveProductDetailTextModel(project, config)).toBe("project-text");
        expect(resolveProductDetailImageModel(project, config)).toBe("project-image");
    });

    it("falls back to the managed workspace model", () => {
        const config = { ...defaultConfig, textModel: "global-text", imageModel: "global-image" };
        expect(resolveProductDetailTextModel(baseProject, config)).toBe("global-text");
        expect(resolveProductDetailImageModel(baseProject, config)).toBe("global-image");
    });
});
