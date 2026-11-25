import { describe, expect, it } from "vitest";

import type { CreateModelPlazaModel } from "@/services/create-account";
import { workbenchPriceLines } from "../model-select";

function imageModel(): CreateModelPlazaModel {
    return {
        name: "gemini-nano-banana-2.1",
        platform: "composite",
        pricing: {
            billing_mode: "image",
            per_request_price: 0.28,
            intervals: [
                { tier_label: "1K", per_request_price: 0.28 },
                { tier_label: "2K", per_request_price: 0.28 },
            ],
        },
    };
}

describe("workbench price lines", () => {
    it("shows the group's base image price when the rate is one", () => {
        expect(workbenchPriceLines(imageModel())).toEqual(["1K · 每张 ￥0.28", "2K · 每张 ￥0.28"]);
    });

    it("applies the resolved group rate to every image tier", () => {
        expect(workbenchPriceLines(imageModel(), 0.5)).toEqual(["1K · 每张 ￥0.14", "2K · 每张 ￥0.14"]);
    });

    it("applies the resolved group rate to video tiers", () => {
        const video: CreateModelPlazaModel = {
            name: "seedance-2.0",
            platform: "composite",
            pricing: {
                billing_mode: "video",
                per_request_price: 0.32,
                intervals: [
                    { tier_label: "480p", per_request_price: 0.32 },
                    { tier_label: "720p", per_request_price: 0.52 },
                ],
            },
        };
        expect(workbenchPriceLines(video, 0.5)).toEqual(["480p · ￥0.16 / 秒", "720p · ￥0.26 / 秒"]);
    });
});