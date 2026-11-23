import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/image", () => ({
    requestEdit: vi.fn(),
    requestGeneration: vi.fn(),
}));

vi.mock("@/services/image-storage", () => ({
    uploadImage: vi.fn(),
}));

import { generateStoryboardImage } from "@/services/product-detail/image-generation";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { defaultConfig } from "@/stores/use-config-store";
import type { ProductDetailAsset, ProductDetailProject, StoryboardPage } from "@/types/product-detail";

const dataUrl = "data:image/png;base64,AAAA";
const brief = {
    ...createEmptyBrief("taobao"),
    productName: "iPhone 18 Pro",
    category: "智能手机",
    sellingPoints: [{ id: "f1", text: "长续航", source: "user" as const }],
    productAssetIds: ["product-1"],
    referenceAssetIds: ["reference-1"],
    revision: 2,
};
const skill = createEmptySkill(1);
const page: StoryboardPage = {
    id: "page-1",
    order: 1,
    role: "hero",
    title: "iPhone 18 Pro · 长续航",
    message: "以三款配色展示产品主视觉。",
    copy: [],
    visualPrompt: "主视觉：三款手机并列，深色背景，顶部留白。",
    negativePrompt: ["不得生成文字"],
    referenceAssetIds: ["product-1", "reference-1"],
    factRefs: ["f1"],
    layoutTemplateId: "clean-commerce",
    status: "draft",
};
const assets: ProductDetailAsset[] = [
    { id: "product-1", name: "product.png", kind: "product", storageKey: "product-key", url: "blob:product", mimeType: "image/png", createdAt: 1 },
    { id: "reference-1", name: "reference.png", kind: "reference", storageKey: "reference-key", url: "blob:reference", mimeType: "image/png", createdAt: 2 },
];
const project: ProductDetailProject = {
    id: "project-1",
    userId: 1,
    name: "iPhone 18 Pro 详情页",
    status: "storyboard_confirmed",
    platform: "taobao",
    brief,
    skillIds: [],
    conversationId: "conversation-1",
    textModel: "gpt-6.2-sol",
    imageModel: "create-managed-image::gpt-image-2",
    messages: [],
    pageSpecs: [],
    assets,
    createdAt: 1,
    updatedAt: 1,
};
const config = {
    ...defaultConfig,
    model: "create-managed-image::gpt-image-2",
    imageModel: "create-managed-image::gpt-image-2",
    size: "1024x1536",
    outputFormat: "png",
    count: "1",
};

describe("product detail image generation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requestEdit).mockResolvedValue([{ id: "result-1", dataUrl }]);
        vi.mocked(requestGeneration).mockResolvedValue([{ id: "result-2", dataUrl }]);
        vi.mocked(uploadImage).mockResolvedValue({
            storageKey: "generated-key",
            url: "blob:generated",
            width: 1024,
            height: 1536,
            bytes: 4096,
            mimeType: "image/png",
        });
    });

    it("sends page-specific prompt and references, then persists the returned original", async () => {
        const result = await generateStoryboardImage(config, project, page, skill);
        const [requestConfig, prompt, references] = vi.mocked(requestEdit).mock.calls[0];

        expect(requestConfig.model).toBe("create-managed-image::gpt-image-2");
        expect(requestConfig.size).toBe("1024x1536");
        expect(prompt).not.toContain(page.title);
        expect(prompt).toContain("主视觉：三款手机并列");
        expect(prompt).toContain("商品外观必须");
        expect(references.map((item) => item.id)).toEqual(["product-1", "reference-1"]);
        expect(uploadImage).toHaveBeenCalledWith(dataUrl);
        expect(result).toMatchObject({
            kind: "generated",
            storageKey: "generated-key",
            width: 1024,
            height: 1536,
            mimeType: "image/png",
        });
    });

    it("uses text-to-image generation when the storyboard has no references", async () => {
        const result = await generateStoryboardImage(
            config,
            { ...project, brief: { ...brief, productAssetIds: [], referenceAssetIds: [] }, assets: [] },
            { ...page, referenceAssetIds: [] },
            skill,
        );

        expect(requestEdit).not.toHaveBeenCalled();
        expect(requestGeneration).toHaveBeenCalledOnce();
        expect(result.storageKey).toBe("generated-key");
    });
});
