import { describe, expect, it } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { createFallbackStoryboard, ensureStoryboardVisualPrompts, isStoryboardStale, isStoryboardUsable, normalizeStoryboard, reorderStoryboard, updateStoryboardPage } from "@/lib/product-detail/storyboard";

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
        expect(moved.status).toBe("draft");
    });

    it("updates only the selected page", () => {
        const storyboard = createFallbackStoryboard(brief, createEmptySkill(1));
        const updated = updateStoryboardPage(storyboard, storyboard.pages[0].id, { title: "新的主标题" });

        expect(updated.pages[0].title).toBe("新的主标题");
        expect(updated.pages[1].title).toBe(storyboard.pages[1].title);
    });

    it("preserves a fallback warning so the UI can explain model degradation", () => {
        const fallback = createFallbackStoryboard(brief, createEmptySkill(1));
        const normalized = normalizeStoryboard({ ...fallback, warning: "文本模型调用失败" }, brief, createEmptySkill(1));

        expect(normalized.warning).toBe("文本模型调用失败");
        expect(isStoryboardUsable(normalized, brief)).toBe(false);
    });

    it("marks a storyboard stale when the brief revision changes", () => {
        const storyboard = { ...createFallbackStoryboard(brief, createEmptySkill(1)), status: "confirmed" as const };
        const changedBrief = { ...brief, revision: brief.revision + 1 };

        expect(isStoryboardStale(storyboard, changedBrief)).toBe(true);
        expect(isStoryboardUsable(storyboard, changedBrief)).toBe(false);
    });

    it("accepts a confirmed storyboard only when it matches the brief revision", () => {
        const storyboard = { ...createFallbackStoryboard(brief, createEmptySkill(1)), status: "confirmed" as const };

        expect(isStoryboardStale(storyboard, brief)).toBe(false);
        expect(isStoryboardUsable(storyboard, brief)).toBe(true);
    });

    it("never trusts an AI response to self-confirm a storyboard", () => {
        const fallback = createFallbackStoryboard(brief, createEmptySkill(1));
        const nextBrief = { ...brief, revision: brief.revision + 3 };
        const normalized = normalizeStoryboard({ ...fallback, status: "confirmed", briefRevision: brief.revision }, nextBrief, createEmptySkill(1));

        expect(normalized.status).toBe("draft");
        expect(normalized.briefRevision).toBe(nextBrief.revision);
    });

    it("uses all product and reference assets as the default page references", () => {
        const storyboard = createFallbackStoryboard({ ...brief, productAssetIds: ["product-1"], referenceAssetIds: ["reference-1"] }, createEmptySkill(1));

        expect(storyboard.pages[0].referenceAssetIds).toEqual(["product-1", "reference-1"]);
    });

    it("gives every fallback page a distinct, page-specific visual prompt", () => {
        const storyboard = createFallbackStoryboard(brief, createEmptySkill(1));
        const prompts = storyboard.pages.map((page) => page.visualPrompt);

        expect(new Set(prompts).size).toBe(prompts.length);
        expect(prompts[0]).toContain("大画幅主视觉");
        expect(prompts[1]).toContain("核心利益转化为可感知");
        expect(prompts.some((prompt) => prompt.includes("微距特写"))).toBe(true);
    });

    it("makes duplicated AI visual prompts unique during normalization", () => {
        const fallback = createFallbackStoryboard(brief, createEmptySkill(1));
        const normalized = normalizeStoryboard({
            ...fallback,
            pages: fallback.pages.map((page) => ({ ...page, visualPrompt: "统一的商品摄影底图" })),
        }, brief, createEmptySkill(1));
        const prompts = normalized.pages.map((page) => page.visualPrompt);

        expect(new Set(prompts).size).toBe(prompts.length);
        expect(prompts[1]).toContain("本页差异化构图");
        expect(prompts[1]).toContain("核心利益转化为可感知");
    });

    it("enriches existing storyboard prompts without appending duplicates on reload", () => {
        const storyboard = {
            ...createFallbackStoryboard(brief, createEmptySkill(1)),
            pages: createFallbackStoryboard(brief, createEmptySkill(1)).pages.map((page) => ({ ...page, visualPrompt: "旧版统一提示词" })),
        };
        const first = ensureStoryboardVisualPrompts(storyboard, brief, createEmptySkill(1));
        const second = ensureStoryboardVisualPrompts(first, brief, createEmptySkill(1));

        expect(first.pages[0].visualPrompt).toContain("第 1 页｜");
        expect(first.pages[0].visualPrompt).toContain("大画幅主视觉");
        expect(new Set(first.pages.map((page) => page.visualPrompt)).size).toBe(first.pages.length);
        expect(second.pages.map((page) => page.visualPrompt)).toEqual(first.pages.map((page) => page.visualPrompt));
    });

    it("fills missing AI page references with the project product and reference assets", () => {
        const briefWithAssets = { ...brief, productAssetIds: ["product-1"], referenceAssetIds: ["reference-1"] };
        const fallback = createFallbackStoryboard(briefWithAssets, createEmptySkill(1));
        const normalized = normalizeStoryboard({
            ...fallback,
            pages: fallback.pages.map((page) => ({ ...page, referenceAssetIds: [] })),
        }, briefWithAssets, createEmptySkill(1));

        expect(normalized.pages.every((page) => page.referenceAssetIds.includes("product-1") && page.referenceAssetIds.includes("reference-1"))).toBe(true);
    });

    it("injects learned category guidance into visual prompts", () => {
        const skill = {
            ...createEmptySkill(1),
            pagePatterns: [{ role: "hero" as const, guidance: "完整卧室场景，突出床品铺陈、面料垂坠和花型对位" }],
        };
        const storyboard = createFallbackStoryboard(brief, skill);

        expect(storyboard.pages[0].visualPrompt).toContain("品类页面经验");
        expect(storyboard.pages[0].visualPrompt).toContain("完整卧室场景");
    });
});