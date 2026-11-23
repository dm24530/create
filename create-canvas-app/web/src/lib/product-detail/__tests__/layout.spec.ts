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
        const image = spec.layers.find((layer) => layer.type === "image");
        expect(image?.type).toBe("image");
        if (image?.type === "image") expect(image.fit).toBe("contain");
        expect(spec.layers.some((layer) => layer.type === "gradient")).toBe(false);
        const textLayer = spec.layers.find((layer) => layer.type === "text");
        if (textLayer?.type === "text") {
            expect(textLayer.style.fontFamily).toContain("Microsoft YaHei");
            expect(textLayer.style.fontWeight).toBeLessThanOrEqual(700);
        }
        expect(validatePageSpec(spec)).toEqual([]);
    });

    it("reports a missing full image as an error", () => {
        const spec = buildPageSpec({ ...page, generatedAssetId: undefined }, brief, createEmptySkill(1), "jd");
        expect(validatePageSpec(spec).some((item) => item.code === "missing_image")).toBe(true);
    });

    it("renders specification copy rows and CTA modules", () => {
        const specPage = buildPageSpec({
            ...page,
            id: "spec-page",
            role: "specification",
            title: "规格与参数",
            message: "核心参数",
            copy: [
                { id: "t", kind: "title", text: "规格与参数" },
                { id: "b", kind: "body", text: "以下为已确认参数。" },
                { id: "s1", kind: "spec", text: "容量：500ml" },
                { id: "s2", kind: "spec", text: "续航：约 12 次" },
            ],
        }, brief, createEmptySkill(1), "taobao");
        const closePage = buildPageSpec({
            ...page,
            id: "close-page",
            role: "closing",
            title: "现在开始体验",
            message: "立即了解产品。",
            copy: [
                { id: "t2", kind: "title", text: "现在开始体验" },
                { id: "b2", kind: "body", text: "立即了解产品。" },
                { id: "c2", kind: "cta", text: "立即购买" },
            ],
        }, brief, createEmptySkill(1), "taobao");
        const specText = specPage.layers.filter((layer) => layer.type === "text").map((layer) => layer.text);
        const closeText = closePage.layers.filter((layer) => layer.type === "text").map((layer) => layer.text);

        expect(specText).toContain("容量：500ml");
        expect(specText).toContain("续航：约 12 次");
        expect(closeText).toContain("立即购买");
        expect(specPage.validation.filter((item) => item.severity === "error")).toEqual([]);
        expect(closePage.validation.filter((item) => item.severity === "error")).toEqual([]);
    });


    it("uses confirmed facts when specification copy has no explicit spec rows", () => {
        const spec = buildPageSpec({
            ...page,
            role: "specification",
            title: "规格与参数",
            copy: [{ id: "t", kind: "title", text: "规格与参数" }],
            factRefs: ["s1"],
        }, brief, createEmptySkill(1), "taobao");
        const texts = spec.layers.filter((layer) => layer.type === "text").map((layer) => layer.text);

        expect(texts).toContain("一键榨汁");
        expect(texts).not.toContain("商品信息 1");
    });

    it("reports text that would be truncated by the renderer", () => {
        const spec = buildPageSpec({
            ...page,
            copy: [
                { id: "t", kind: "title", text: "很长的标题".repeat(40) },
                { id: "b", kind: "body", text: "很长的正文".repeat(80) },
            ],
        }, brief, createEmptySkill(1), "pdd");

        expect(spec.validation.some((item) => item.code === "text_overflow")).toBe(true);
        expect(spec.overflowStatus).toBe("error");
    });

    it("places every text block below the generated image area", () => {
        const roles: StoryboardPage["role"][] = [
            "hero", "pain-point", "core-benefit", "feature-detail",
            "scenario", "how-to-use", "specification", "trust", "closing",
        ];
        for (const role of roles) {
            const spec = buildPageSpec({
                ...page,
                id: `page-${role}`,
                role,
                copy: [
                    { id: "title", kind: "title", text: `${role} 标题` },
                    { id: "body", kind: "body", text: `${role} 正文` },
                    { id: "spec", kind: "spec", text: "规格：测试值" },
                    { id: "cta", kind: "cta", text: "立即查看" },
                ],
            }, brief, createEmptySkill(1), "taobao");
            const image = spec.layers.find((layer) => layer.type === "image");
            expect(image).toBeDefined();
            if (!image) continue;
            const imageBottom = image.rect.y + image.rect.height;
            for (const layer of spec.layers.filter((item) => item.type === "text")) {
                expect(layer.rect.y, `${role} text layer must start below the image`).toBeGreaterThanOrEqual(imageBottom);
            }
        }
    });

    it("does not expose internal module labels, page markers or page numbers", () => {
        const spec = buildPageSpec({
            ...page,
            copy: [
                { id: "eyebrow", kind: "eyebrow", text: "首屏主视觉" },
                { id: "title", kind: "title", text: "图片1｜便携榨汁杯" },
                { id: "body", kind: "body", text: "第 1 页 为上班族打造的便携榨汁杯。" },
                { id: "spec", kind: "spec", text: "编号：A-01｜一键榨汁" },
            ],
        }, brief, createEmptySkill(1), "taobao");
        const texts = spec.layers.filter((layer) => layer.type === "text").map((layer) => layer.text);

        expect(texts).toContain("便携榨汁杯");
        expect(texts).toContain("为上班族打造的便携榨汁杯。");
        expect(texts).toContain("一键榨汁");
        expect(texts).not.toContain("首屏主视觉");
        expect(texts).not.toContain("01");
        expect(texts.some((text) => /P\d+|第\s*\d+\s*页|图片\s*\d+|编码|编号/.test(text))).toBe(false);
    });
});
