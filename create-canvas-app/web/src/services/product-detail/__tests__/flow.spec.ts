import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/image", () => ({ requestImageQuestion: vi.fn() }));
vi.mock("@/services/image-storage", () => ({
    prepareReferenceImagesForRequest: vi.fn(async (assets: Array<{ dataUrl: string }>) => assets.map((asset) => ({ ...asset, dataUrl: asset.dataUrl || "data:image/png;base64,AAAA" }))),
}));

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { mergeProductBrief } from "@/lib/product-detail/brief";
import { ensureBuiltinSkills } from "@/lib/product-detail/builtin-skills";
import { buildNoTextImagePrompt } from "@/lib/product-detail/image-prompt";
import { createFallbackStoryboard, isStoryboardUsable } from "@/lib/product-detail/storyboard";
import { requestProductDetailTurn } from "@/services/product-detail/conversation";
import { requestProductDetailStoryboard } from "@/services/product-detail/storyboard";
import { requestImageQuestion } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import type { ProductDetailAsset } from "@/types/product-detail";

const config = { baseUrl: "https://api.example.com", apiKey: "test", model: "text-model", textModel: "text-model" } as AiConfig;
const reference: ProductDetailAsset = {
    id: "product-1",
    name: "bedding.png",
    kind: "product",
    storageKey: "product-key",
    url: "data:image/png;base64,AAAA",
    mimeType: "image/png",
    width: 800,
    height: 1000,
    createdAt: Date.now(),
};

describe("product detail mocked end-to-end flow", () => {
    it("moves from image analysis to Brief, storyboard, and image prompt without inventing style", async () => {
        vi.mocked(requestImageQuestion).mockReset();
        let brief = createEmptyBrief("taobao");
        const turnResponse = {
            message: "参考图是奶白色纯棉床品，卧室光线柔和。还需要确认主要售卖的人群。",
            briefPatch: {
                productName: "奶白纯棉四件套",
                category: "床品四件套",
                description: "参考图可见奶白色纯棉床品与柔和卧室氛围",
                targetAudience: ["家庭用户"],
                sellingPoints: [{ id: "fact-1", text: "100% 纯棉", source: "user" }],
                visualStyle: ["柔和自然光", "温馨卧室"],
                colorPreference: ["#F2EEE8"],
                productAssetIds: ["product-1"],
            },
            readyToPlan: true,
            assumptions: [],
            risks: [],
        };
        vi.mocked(requestImageQuestion).mockResolvedValueOnce(JSON.stringify(turnResponse));

        const turn = await requestProductDetailTurn(config, {
            brief,
            messages: [],
            userMessage: "请先分析我上传的商品图，再告诉我还缺什么。",
            attachments: [reference],
        });
        brief = mergeProductBrief(brief, turn.briefPatch || {});
        const skill = ensureBuiltinSkills([], 1)[0];
        const fallback = createFallbackStoryboard(brief, skill);
        vi.mocked(requestImageQuestion).mockResolvedValueOnce(JSON.stringify(fallback));

        const storyboard = await requestProductDetailStoryboard(config, brief, skill, [reference]);
        const prompt = buildNoTextImagePrompt(storyboard.pages[0], brief, skill);

        expect(brief.productName).toBe("奶白纯棉四件套");
        expect(brief.colorPreference).toEqual(["#F2EEE8"]);
        expect(skill.brand.colors).toEqual([]);
        expect(storyboard.pages.length).toBeGreaterThanOrEqual(6);
        expect(storyboard.pages.every((page) => page.referenceAssetIds.includes(reference.id))).toBe(true);
        expect(isStoryboardUsable(storyboard, brief)).toBe(false);
        expect(prompt).toContain("以参考图为主要依据");
        expect(prompt).toContain("不预设品牌色板");
        expect(prompt).toContain("不得生成任何文字");
    });
});