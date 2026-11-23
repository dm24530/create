import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { hasProductImageReference, MAX_CONVERSATION_REFERENCE_IMAGES, MAX_STORYBOARD_REFERENCE_IMAGES, prioritizeReferenceAssets, selectStoryboardReferenceAssets } from "@/lib/product-detail/reference-selection";
import type { ProductDetailAsset, ProductDetailProject, StoryboardPage } from "@/types/product-detail";

function asset(id: string, kind: ProductDetailAsset["kind"]): ProductDetailAsset {
    return { id, name: `${id}.png`, kind, mimeType: "image/png", createdAt: 1 };
}

function projectWith(assets: ProductDetailAsset[], productAssetIds: string[], referenceAssetIds: string[]): ProductDetailProject {
    return {
        id: "project-1",
        userId: 1,
        name: "测试详情页",
        status: "storyboard_draft",
        platform: "taobao",
        brief: { ...createEmptyBrief("taobao"), productAssetIds, referenceAssetIds },
        skillIds: [],
        conversationId: "conversation-1",
        messages: [],
        pageSpecs: [],
        assets,
        createdAt: 1,
        updatedAt: 1,
    };
}

function pageWith(referenceAssetIds: string[]): StoryboardPage {
    return {
        id: "page-1",
        order: 1,
        role: "hero",
        title: "主视觉",
        message: "商品主视觉",
        copy: [],
        visualPrompt: "干净商业摄影",
        negativePrompt: [],
        referenceAssetIds,
        factRefs: [],
        layoutTemplateId: "clean-commerce",
        status: "draft",
    };
}

describe("product detail reference selection", () => {
    it("keeps product truth before style references and removes duplicates", () => {
        const project = projectWith(
            [asset("p1", "product"), asset("r1", "reference")],
            ["p1"],
            ["r1"],
        );

        expect(selectStoryboardReferenceAssets(project, pageWith(["r1", "p1"])).map((item) => item.id))
            .toEqual(["p1", "r1"]);
    });

    it("caps references while preserving all available product images first", () => {
        const products = Array.from({ length: 5 }, (_, index) => asset(`p${index + 1}`, "product"));
        const references = Array.from({ length: 5 }, (_, index) => asset(`r${index + 1}`, "reference"));
        const project = projectWith(
            [...products, ...references],
            products.map((item) => item.id),
            references.map((item) => item.id),
        );

        const selected = selectStoryboardReferenceAssets(project, pageWith([]));

        expect(selected).toHaveLength(MAX_STORYBOARD_REFERENCE_IMAGES);
        expect(selected.slice(0, products.length).every((item) => item.kind === "product")).toBe(true);
        expect(selected.slice(products.length).every((item) => item.kind === "reference")).toBe(true);
    });

    it("limits conversation images before compression and keeps product images first", () => {
        const assets = [
            ...Array.from({ length: 3 }, (_, index) => asset(`r${index + 1}`, "reference")),
            ...Array.from({ length: 2 }, (_, index) => asset(`p${index + 1}`, "product")),
        ];
        const selected = prioritizeReferenceAssets(assets, MAX_CONVERSATION_REFERENCE_IMAGES);

        expect(selected).toHaveLength(MAX_CONVERSATION_REFERENCE_IMAGES);
        expect(selected[0].id).toBe("p1");
        expect(selected[1].id).toBe("p2");
        expect(selected.filter((item) => item.kind === "product")).toHaveLength(2);
    });

    it("requires at least one product truth image before rendering", () => {
        expect(hasProductImageReference([asset("r1", "reference")])).toBe(false);
        expect(hasProductImageReference([asset("r1", "reference"), asset("p1", "product")])).toBe(true);
    });
});