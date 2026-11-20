import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { buildPageSpec, validatePageSpec } from "@/lib/product-detail/layout";
import type { StoryboardPage } from "@/types/product-detail";

const brief = { ...createEmptyBrief("taobao"), productName: "便携榨汁杯", category: "厨房小家电", targetAudience: ["上班族"], sellingPoints: [{ id: "s1", text: "一键榨汁", source: "user" as const }] };
const page: StoryboardPage = {
    id: "page-1", order: 1, role: "hero", title: "便携榨汁杯", message: "为上班族打造的便携榨汁杯。",
    copy: [{ id: "c1", kind: "title", text: "便携榨汁杯" }, { id: "c2", kind: "body", text: "为上班族打造的便携榨汁杯。" }],
    visualPrompt: "", negativePrompt: [], referenceAssetIds: [], factRefs: ["s1"], layoutTemplateId: "clean-commerce", status: "ready", generatedAssetId: "asset-1",
};

describe("product detail layout", () => {
    it("builds a 750px page with text inside safe margins", () => {
        const spec = buildPageSpec(page, brief, createEmptySkill(1), "taobao");
        expect(spec.width).toBe(750);
        expect(spec.layers.some((layer) => layer.type === "image")).toBe(true);
        expect(validatePageSpec(spec)).toEqual([]);
    });

    it("reports a missing full image as an error", () => {
        const spec = buildPageSpec({ ...page, generatedAssetId: undefined }, brief, createEmptySkill(1), "jd");
        expect(validatePageSpec(spec).some((item) => item.code === "missing_image")).toBe(true);
    });
});
