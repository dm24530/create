import { describe, expect, it } from "vitest";

import { isPlazaVideoModel, plazaVideoBillingUnit, plazaVideoDurationLabel, plazaVideoPricingRows } from "../plaza-video-model";
import type { CreateModelPlazaModel } from "@/services/create-account";

function model(overrides: Partial<CreateModelPlazaModel> = {}): CreateModelPlazaModel {
    return {
        name: "seedance-2.0",
        platform: "openai",
        pricing: {
            billing_mode: "video",
            per_request_price: 0.38,
            intervals: [
                { tier_label: "480p", per_request_price: 0.38 },
                { tier_label: "720p", per_request_price: 0.6 },
            ],
        },
        ...overrides,
    };
}

describe("model plaza video pricing metadata", () => {
    it("recognizes per-request video models by their catalog name", () => {
        const value = model({ name: "seedance 2.0 fast-GT" });
        value.pricing!.billing_mode = "per_request";

        expect(isPlazaVideoModel(value)).toBe(true);
        expect(plazaVideoBillingUnit(value)).toBe("request");
    });

    it("shows a range for flexible durations and exact choices for fixed presets", () => {
        expect(plazaVideoDurationLabel(model())).toBe("5–15s");
        expect(plazaVideoDurationLabel(model({ name: "seedance 2.0 fast-GT" }))).toBe("10s / 15s");
    });

    it("compresses consecutive presets into readable duration ranges", () => {
        expect(plazaVideoDurationLabel(model({ name: "muse-cheap" }))).toBe("1–10s / 20s / 30s");
    });
    it("keeps each resolution on its own row with its own price", () => {
        expect(plazaVideoPricingRows(model())).toEqual([
            { key: "0:480p", resolution: "480p", price: 0.38 },
            { key: "1:720p", resolution: "720p", price: 0.6 },
        ]);
    });

    it("falls back to a standard row when no resolution tiers exist", () => {
        const value = model();
        value.pricing!.intervals = [];
        value.pricing!.per_request_price = 0.4;

        expect(plazaVideoPricingRows(value)).toEqual([
            { key: "standard", resolution: "标准", price: 0.4 },
        ]);
    });
});

