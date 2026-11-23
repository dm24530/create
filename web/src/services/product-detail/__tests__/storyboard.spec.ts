import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/image", () => ({ requestImageQuestion: vi.fn() }));
vi.mock("@/services/image-storage", () => ({
    prepareReferenceImagesForRequest: vi.fn(async (assets: Array<{ dataUrl: string }>) => assets.map((asset) => ({ ...asset, dataUrl: asset.dataUrl || "data:image/png;base64,AAAA" }))),
}));

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { createFallbackStoryboard } from "@/lib/product-detail/storyboard";
import { requestProductDetailStoryboard } from "@/services/product-detail/storyboard";
import { requestImageQuestion } from "@/services/api/image";
import { prepareReferenceImagesForRequest } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductDetailAsset } from "@/types/product-detail";

const config = { baseUrl: "https://api.example.com", apiKey: "test", model: "text-model", textModel: "text-model" } as AiConfig;
const brief = {
    ...createEmptyBrief("taobao"),
    productName: "纯棉四件套",
    category: "床品四件套",
    description: "用户参考图里的奶白色纯棉床品",
    targetAudience: ["家庭用户"],
    sellingPoints: [{ id: "s1", text: "100% 纯棉", source: "user" as const }],
};
const skill = createEmptySkill(1);
const asset: ProductDetailAsset = {
    id: "reference-1",
    name: "reference.png",
    kind: "reference",
    storageKey: "reference-key",
    url: "data:image/png;base64,AAAA",
    mimeType: "image/png",
    width: 800,
    height: 600,
    createdAt: Date.now(),
};

describe("product detail storyboard request", () => {
    beforeEach(() => {
        vi.mocked(requestImageQuestion).mockReset();
        vi.mocked(prepareReferenceImagesForRequest).mockClear();
        vi.mocked(requestImageQuestion).mockResolvedValue(JSON.stringify(createFallbackStoryboard(brief, skill)));
    });

    it("sends user reference images so visual style is not invented before analysis", async () => {
        await requestProductDetailStoryboard(config, brief, skill, [asset]);
        const messages = vi.mocked(requestImageQuestion).mock.calls[0][1];
        const userMessage = messages.find((message) => message.role === "user");
        const content = userMessage?.content;
        const text = Array.isArray(content) ? content.find((item) => item.type === "text")?.text || "" : String(content || "");

        expect(Array.isArray(content)).toBe(true);
        if (Array.isArray(content)) {
            expect(content.some((item) => item.type === "image_url" && item.image_url.url === asset.url)).toBe(true);
        }
        expect(text).toContain("不得套用预设色板或默认风格");
        expect(text).toContain("只提供结构、类目知识和约束");
    });

    it("selects at most eight product-first images before preparing the storyboard request", async () => {
        const assets = [
            ...Array.from({ length: 6 }, (_, index) => ({ ...asset, id: `r${index + 1}`, name: `r${index + 1}.png`, kind: "reference" as const })),
            ...Array.from({ length: 3 }, (_, index) => ({ ...asset, id: `p${index + 1}`, name: `p${index + 1}.png`, kind: "product" as const })),
        ];

        await requestProductDetailStoryboard(config, brief, skill, assets);
        const prepared = vi.mocked(prepareReferenceImagesForRequest).mock.calls[0][0] as ProductDetailAsset[];

        expect(prepared).toHaveLength(8);
        expect(prepared.slice(0, 3).map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
    });
});