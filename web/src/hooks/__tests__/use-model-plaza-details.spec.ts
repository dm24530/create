import { describe, expect, it } from "vitest";

import type { CreateModelPlazaGroup } from "@/services/create-account";
import { buildWorkbenchModelDetails, workbenchGroupRates, workbenchModelDetailKey } from "../use-model-plaza-details";

const modelName = "gemini-nano-banana-2.1";

function group(id: number, name: string, price: number, overrides: Partial<CreateModelPlazaGroup> = {}): CreateModelPlazaGroup {
    return {
        id,
        name,
        platform: "composite",
        rate_multiplier: 1,
        models: [{
            name: modelName,
            platform: "composite",
            pricing: {
                billing_mode: "image",
                per_request_price: price,
                intervals: [{ tier_label: "1K", per_request_price: price }],
            },
        }],
        ...overrides,
    };
}

describe("workbench model plaza details", () => {
    it("keeps the same model's price scoped to its group", () => {
        const details = buildWorkbenchModelDetails([
            group(4, "综合-便宜", 0.15),
            group(5, "标准分组", 0.28),
        ]);

        expect(details.byGroupModel[workbenchModelDetailKey("综合-便宜", modelName)].model.pricing?.per_request_price).toBe(0.15);
        expect(details.byGroupModel[workbenchModelDetailKey("标准分组", modelName)].model.pricing?.per_request_price).toBe(0.28);
        expect(details.byGroupModel[workbenchModelDetailKey("综合-便宜", modelName)].groupName).toBe("综合-便宜");
    });

    it("normalizes group and model keys for lookup", () => {
        expect(workbenchModelDetailKey(" 综合-便宜 ", " GEMINI-NANO-BANANA-2.1 ")).toBe("综合-便宜::gemini-nano-banana-2.1");
    });

    it("uses the user rate unless image or video pricing is independent", () => {
        expect(workbenchGroupRates(group(1, "普通分组", 0.15, { user_rate_multiplier: 0.5 }))).toEqual({
            rate: 0.5,
            imageRate: 0.5,
            videoRate: 0.5,
        });

        expect(workbenchGroupRates(group(2, "独立倍率", 0.15, {
            user_rate_multiplier: 0.5,
            image_rate_independent: true,
            image_rate_multiplier: 0.8,
            video_rate_independent: true,
            video_rate_multiplier: 0.6,
        }))).toEqual({
            rate: 0.5,
            imageRate: 0.8,
            videoRate: 0.6,
        });
    });
});