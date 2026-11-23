import { describe, expect, it } from "vitest";

import { classifyProductDetailGenerationIntent } from "@/lib/product-detail/intent";

describe("product detail generation intent", () => {
    it("treats explicit implementation requests as image generation", () => {
        expect(classifyProductDetailGenerationIntent("开始实现")).toBe("images");
        expect(classifyProductDetailGenerationIntent("按现有分镜生成全部 6 屏图片")).toBe("images");
        expect(classifyProductDetailGenerationIntent("直接生成所有页面底图")).toBe("images");
    });

    it("distinguishes storyboard-only requests", () => {
        expect(classifyProductDetailGenerationIntent("请先生成页面分镜")).toBe("storyboard");
        expect(classifyProductDetailGenerationIntent("帮我规划分镜")).toBe("storyboard");
    });

    it("leaves ordinary design discussion to the text model", () => {
        expect(classifyProductDetailGenerationIntent("改成京东，风格更高级")).toBeNull();
    });
});