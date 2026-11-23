import { describe, expect, it } from "vitest";

import { createEmptyBrief, isProductBriefReady, mergeProductBrief, missingProductBriefFields, sanitizeProductBriefPatch } from "@/lib/product-detail/brief";

describe("product detail brief", () => {
    it("keeps confirmed facts and increments revision when a patch is merged", () => {
        const brief = createEmptyBrief("taobao");
        const next = mergeProductBrief(brief, {
            productName: "便携榨汁杯",
            category: "厨房小家电",
            targetAudience: ["上班族", "健身人群"],
            sellingPoints: [{ id: "s1", text: "一键榨汁", source: "user" }],
        });

        expect(next.productName).toBe("便携榨汁杯");
        expect(next.targetAudience).toEqual(["上班族", "健身人群"]);
        expect(next.revision).toBe(1);
        expect(isProductBriefReady(next)).toBe(true);
    });

    it("requires a confirmed selling point before planning can start", () => {
        const brief = mergeProductBrief(createEmptyBrief("jd"), {
            productName: "咖啡滤杯",
            category: "咖啡器具",
            targetAudience: ["咖啡爱好者"],
            sellingPoints: [{ id: "s1", text: "猜测为陶瓷材质", source: "unconfirmed" }],
        });

        expect(isProductBriefReady(brief)).toBe(false);
    });

    it("allows an explicit array replacement and empty text clearing", () => {
        const brief = mergeProductBrief(createEmptyBrief("pdd"), {
            productName: "测试商品",
            visualStyle: ["清爽", "年轻"],
        });
        const next = mergeProductBrief(brief, {
            productName: "",
            visualStyle: ["高端"],
        });

        expect(next.productName).toBe("");
        expect(next.visualStyle).toEqual(["高端"]);
        expect(next.revision).toBe(2);
    });

    it("reports the actual missing brief fields", () => {
        const brief = { ...createEmptyBrief("taobao"), productName: "便携水壶", category: "水具", targetAudience: ["上班族"] };
        expect(missingProductBriefFields(brief)).toEqual(["核心卖点"]);
    });

    it("accepts string selling points returned by the model", () => {
        const patch = sanitizeProductBriefPatch({ sellingPoints: ["便携外出"] });
        expect(patch?.sellingPoints).toEqual([{ id: "fact-1", text: "便携外出", source: "user" }]);
    });
});