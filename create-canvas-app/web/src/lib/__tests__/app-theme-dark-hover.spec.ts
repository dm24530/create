import { describe, expect, it } from "vitest";

import { getAntThemeConfig } from "@/lib/app-theme";

describe("dark theme hover contrast", () => {
    it("keeps Ant Design button hover text readable", () => {
        const button = getAntThemeConfig(true).components?.Button;
        expect(button?.defaultHoverColor).toBe("#ffffff");
        expect(button?.defaultHoverBg).toBe("rgba(255, 255, 255, 0.10)");
        expect(button?.textTextHoverColor).toBe("#ffffff");
        expect(button?.textHoverBg).toBe("rgba(255, 255, 255, 0.08)");
    });

    it("uses a dark selected segment instead of a white thumb with light text", () => {
        const segmented = getAntThemeConfig(true).components?.Segmented;
        expect(segmented?.itemSelectedBg).toBe("#292524");
        expect(segmented?.itemSelectedColor).toBe("#fafaf9");
        expect(segmented?.itemHoverColor).toBe("#ffffff");
        expect(segmented?.itemHoverBg).toBe("rgba(255, 255, 255, 0.08)");
    });
});
