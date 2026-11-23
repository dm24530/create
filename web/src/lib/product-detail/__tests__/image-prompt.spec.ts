import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { buildNoTextImagePrompt, buildNoTextNegativePrompt } from "@/lib/product-detail/image-prompt";
import type { StoryboardPage } from "@/types/product-detail";

const brief = {
    ...createEmptyBrief("taobao"),
    productName: "便携榨汁杯",
    category: "厨房小家电",
    targetAudience: ["上班族"],
    sellingPoints: [{ id: "s1", text: "一键榨汁", source: "user" as const }],
    visualStyle: ["清爽"],
    colorPreference: ["#F5F0E8"],
};

const page: StoryboardPage = {
    id: "page-1",
    order: 1,
    role: "hero",
    title: "便携榨汁杯",
    message: "为上班族打造的便携榨汁杯。",
    copy: [],
    visualPrompt: "产品主视觉",
    negativePrompt: [],
    referenceAssetIds: [],
    factRefs: ["s1"],
    layoutTemplateId: "clean-commerce",
    status: "draft",
};

describe("product detail image prompt", () => {
    it("requires no text and product truth preservation", () => {
        const prompt = buildNoTextImagePrompt(page, brief, createEmptySkill(1));

        expect(prompt).toContain("不得新增任何文字");
        expect(prompt).toContain("已有的 Logo 和品牌标记必须保持原样");
        expect(prompt).toContain("保持商品外观一致");
        expect(prompt).toContain("留出安全区");
        expect(prompt).toContain("便携榨汁杯");
        expect(prompt).toContain("必须以参考图为主要依据");
        expect(prompt).toContain("不预设品牌色板");
        expect(prompt).toContain("只生成一张连续的商业摄影画面");
        expect(prompt).toContain("不要复刻参考图的排版结构");
        expect(prompt).not.toContain("为上班族打造的便携榨汁杯");
        expect(prompt).not.toMatch(/第\s*\d+\s*页/);
        expect(buildNoTextNegativePrompt(page)).toEqual(expect.arrayContaining(["标题文字", "价格", "伪文字", "乱码"]));
    });
});
