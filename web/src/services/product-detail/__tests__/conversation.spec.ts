import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/image", () => ({ requestImageQuestion: vi.fn() }));
vi.mock("@/services/image-storage", () => ({
    prepareReferenceImagesForRequest: vi.fn(async (assets: Array<{ dataUrl: string }>) => assets.map((asset) => ({ ...asset, dataUrl: asset.dataUrl || "data:image/png;base64,AAAA" }))),
}));

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { requestProductDetailTurn } from "@/services/product-detail/conversation";
import { requestImageQuestion } from "@/services/api/image";
import { prepareReferenceImagesForRequest } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductDetailAsset } from "@/types/product-detail";

const config = { baseUrl: "https://api.example.com", apiKey: "test", model: "text-model", textModel: "text-model" } as AiConfig;
const brief = { ...createEmptyBrief("taobao"), productName: "纯棉四件套", category: "床品四件套" };

function imageAsset(id: string, kind: ProductDetailAsset["kind"]): ProductDetailAsset {
    return { id, name: `${id}.png`, kind, storageKey: id, url: `data:image/png;base64,${id}`, mimeType: "image/png", width: 800, height: 600, createdAt: Date.now() };
}

describe("product detail conversation request", () => {
    beforeEach(() => {
        vi.mocked(requestImageQuestion).mockReset();
        vi.mocked(requestImageQuestion).mockResolvedValue(JSON.stringify({ message: "已分析参考图", readyToPlan: false, assumptions: [], risks: [] }));
        vi.mocked(prepareReferenceImagesForRequest).mockClear();
    });

    it("selects product-first conversation images before compression", async () => {
        const attachments = [
            imageAsset("r1", "reference"),
            imageAsset("r2", "reference"),
            imageAsset("p1", "product"),
            imageAsset("p2", "product"),
            imageAsset("r3", "reference"),
            imageAsset("r4", "reference"),
        ];

        await requestProductDetailTurn(config, { brief, messages: [], userMessage: "请帮我分析", attachments });
        const preparedAssets = vi.mocked(prepareReferenceImagesForRequest).mock.calls[0][0] as ProductDetailAsset[];

        expect(preparedAssets).toHaveLength(4);
        expect(preparedAssets.slice(0, 2).map((asset) => asset.id)).toEqual(["p1", "p2"]);
        expect(preparedAssets.map((asset) => asset.id)).toEqual(["p1", "p2", "r1", "r2"]);
    });

    it("fails closed instead of silently asking without reference images", async () => {
        vi.mocked(prepareReferenceImagesForRequest).mockRejectedValueOnce(new Error("参考图片总量超过安全上限"));

        await expect(requestProductDetailTurn(config, {
            brief,
            messages: [],
            userMessage: "请分析",
            attachments: [imageAsset("p1", "product")],
        })).rejects.toThrow("参考图片总量超过安全上限");
    });
});