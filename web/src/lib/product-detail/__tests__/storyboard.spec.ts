import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { createFallbackStoryboard, reorderStoryboard, updateStoryboardPage } from "@/lib/product-detail/storyboard";

const brief = {
    ...createEmptyBrief("taobao"),
    productName: "便携榨汁杯",
    category: "厨房小家电",
    description: "适合办公室和健身场景的便携榨汁杯",
    targetAudience: ["上班族", "健身人群"],
    scenarios: ["办公室", "健身房"],
    sellingPoints: [
        { id: "s1", text: "一键榨汁", source: "user" as const },
        { id: "s2", text: "杯身可拆洗", source: "user" as const },
    ],
    visualStyle: ["清爽", "年轻"],
    colorPreference: ["#F5F0E8", "#111111"],
    copyTone: ["直接"],
    forbiddenContent: ["包治百病"],
};

describe("product detail storyboard", () => {
    it("creates six to ten ordered pages with hero first", () => {
        const storyboard = createFallbackStoryboard(brief, createEmptySkill(1));

        expect(storyboard.pages.length).toBeGreaterThanOrEqual(6);
        expect(storyboard.pages.length).toBeLessThanOrEqual(10);
        expect(storyboard.pages[0].role).toBe("hero");
        expect(storyboard.pages.map((page) => page.order)).toEqual(storyboard.pages.map((_, index) => index + 1));
    });

    it("reorders one page without mutating the original storyboard", () => {
        const storyboard = createFallbackStoryboard(brief, createEmptySkill(1));
        const moved = reorderStoryboard(storyboard, storyboard.pages[1].id, -1);

        expect(moved.pages[0].id).toBe(storyboard.pages[1].id);
        expect(storyboard.pages[0].id).not.toBe(storyboard.pages[1].id);
    });

    it("updates only the selected page", () => {
        const storyboard = createFallbackStoryboard(brief, createEmptySkill(1));
        const updated = updateStoryboardPage(storyboard, storyboard.pages[0].id, { title: "新的主标题" });

        expect(updated.pages[0].title).toBe("新的主标题");
        expect(updated.pages[1].title).toBe(storyboard.pages[1].title);
    });
});
