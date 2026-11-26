import { describe, expect, it } from "vitest";

import {
    effectiveImageQualityForRequest,
    imageQualityFallbackNote,
    imageQualityOptionsForModel,
} from "../image-quality";

describe("image quality policy", () => {
    it("shows the full quality range for GPT image models", () => {
        expect(imageQualityOptionsForModel("group::gpt-image-2.6")).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    });

    it("limits Gemini flash lite to auto and low", () => {
        expect(imageQualityOptionsForModel("gemini-3.1-flash-lite-image")).toEqual(["auto", "low"]);
        expect(effectiveImageQualityForRequest("gemini-3.1-flash-lite-image", "max")).toBe("low");
    });

    it("uses a lower supported quality for generic image models", () => {
        expect(imageQualityOptionsForModel("seedream-4")).toEqual(["auto", "low", "medium", "high"]);
        expect(effectiveImageQualityForRequest("seedream-4", "max")).toBe("high");
    });

    it("caps GPT image requests without changing the selected display value", () => {
        expect(effectiveImageQualityForRequest("gpt-image-2", "max", "high")).toBe("high");
        expect(effectiveImageQualityForRequest("gpt-image-2", "xhigh", "max")).toBe("xhigh");
        expect(imageQualityFallbackNote("gpt-image-2", "max", "high")).toContain("按 high 调用");
    });

    it("does not expose model quality controls for Grok image models", () => {
        expect(imageQualityOptionsForModel("grok-imagine-image")).toEqual([]);
        expect(effectiveImageQualityForRequest("grok-imagine-image", "max")).toBe("auto");
    });
});