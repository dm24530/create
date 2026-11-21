import { describe, expect, it } from "vitest";

import type { CreateModelPlazaModel } from "@/services/create-account";
import { videoDurationLabel, videoPricingRows } from "../create-model-plaza-modal";

const videoCapabilities = {
    protocol: "seedance_video",
    min_duration: 5,
    max_duration: 15,
    default_duration: 10,
    duration_options: [5, 10, 15],
    resolutions: ["720p"],
    aspect_ratios: ["16:9"],
    slots: { first_frame: 0, last_frame: 0, reference_image: 9, reference_video: 0, reference_audio: 0 },
};

const perRequestModel: CreateModelPlazaModel = {
    name: "seedance-2.0-mini",
    platform: "openai",
    description: "固定 720p，5/10/15 秒同价。",
    pricing: {
        billing_mode: "per_request",
        intervals: [
            { tier_label: "720p-5s", min_tokens: 5, max_tokens: 5, per_request_price: 1.7 },
            { tier_label: "720p-10s", min_tokens: 10, max_tokens: 10, per_request_price: 1.7 },
            { tier_label: "720p-15s", min_tokens: 15, max_tokens: 15, per_request_price: 1.7 },
        ],
    },
    video_capabilities: videoCapabilities,
};

describe("App model plaza video cards", () => {
    it("renders per-request models with one row per supported duration", () => {
        expect(videoPricingRows(perRequestModel)).toEqual([
            { key: "0:720p-5s", resolution: "720p", duration: "5s", price: 1.7 },
            { key: "1:720p-10s", resolution: "720p", duration: "10s", price: 1.7 },
            { key: "2:720p-15s", resolution: "720p", duration: "15s", price: 1.7 },
        ]);
    });

    it("renders per-second models with the full duration range", () => {
        const rows = videoPricingRows({
            ...perRequestModel,
            pricing: {
                billing_mode: "video",
                intervals: [{ tier_label: "720p", per_request_price: 0.5 }],
            },
        });

        expect(rows).toEqual([
            { key: "0:720p", resolution: "720p", duration: "5s / 10s / 15s", price: 0.5 },
        ]);
    });

    it("does not invent pricing for token-billed video models", () => {
        expect(videoPricingRows({
            ...perRequestModel,
            pricing: { billing_mode: "token", intervals: [] },
        })).toEqual([]);
    });

    it("compresses duration ranges like the Web plaza", () => {
        expect(videoDurationLabel({
            ...perRequestModel,
            video_capabilities: {
                ...videoCapabilities,
                min_duration: 5,
                max_duration: 30,
                duration_options: [5, 6, 7, 8, 9, 10, 20, 30],
            },
        })).toBe("5-10s / 20s / 30s");
    });
});