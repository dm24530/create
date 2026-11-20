import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { buildNoTextImagePrompt } from "@/lib/product-detail/image-prompt";
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

        expect(prompt).toContain("不得生成任何文字");
        expect(prompt).toContain("保持商品外观一致");
        expect(prompt).toContain("留出文案安全区");
        expect(prompt).toContain("便携榨汁杯");
    });
});
