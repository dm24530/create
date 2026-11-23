import { describe, expect, it } from "vitest";

import {
    requestPriceColumns,
    splitStandardPricingModels,
    tokenPriceColumns,
} from "@/components/create-account/create-model-plaza-modal";
import type { CreateModelPlazaModel } from "@/services/create-account";

const imageModel: CreateModelPlazaModel = {
    name: "gemini-image",
    platform: "gemini",
    pricing: {
        billing_mode: "image",
        intervals: [
            { tier_label: "1K", per_request_price: 0.28 },
            { tier_label: "2K", per_request_price: 0.28 },
            { tier_label: "4K", per_request_price: 0.28 },
        ],
    },
};

const textModel: CreateModelPlazaModel = {
    name: "gpt-text",
    platform: "openai",
    pricing: {
        billing_mode: "token",
        intervals: [
            { tier_label: "≤272K", input_price: 0.000005, output_price: 0.00003 },
            { tier_label: ">272K", input_price: 0.00001, output_price: 0.000045 },
        ],
    },
};

const mixedTextModel: CreateModelPlazaModel = {
    name: "text-with-request-fallback",
    platform: "openai",
    pricing: {
        billing_mode: "token",
        intervals: [
            { tier_label: "≤272K", per_request_price: 0.002, input_price: 0.000005, output_price: 0.00003 },
            { tier_label: ">272K", per_request_price: 0.003, input_price: 0.00001, output_price: 0.000045 },
        ],
    },
};
describe("模型广场标准价格表", () => {
    it("把图片按次模型和文本 Token 模型分开，并只显示各自相关的价格列", () => {
        const split = splitStandardPricingModels([imageModel, textModel]);

        expect(split.requestModels.map((model) => model.name)).toEqual(["gemini-image"]);
        expect(split.tokenModels.map((model) => model.name)).toEqual(["gpt-text"]);
        expect(requestPriceColumns(split.requestModels).map((column) => column.label)).toEqual(["1K", "2K", "4K"]);
        expect(tokenPriceColumns(split.tokenModels).map((column) => column.label)).toEqual(["≤272K", ">272K"]);
    });
    it("显式 Token 计费模型即使带有按次价格，也不会混入图片价格列", () => {
        const split = splitStandardPricingModels([imageModel, mixedTextModel]);

        expect(split.requestModels.map((model) => model.name)).toEqual(["gemini-image"]);
        expect(split.tokenModels.map((model) => model.name)).toEqual(["text-with-request-fallback"]);
        expect(requestPriceColumns(split.requestModels).map((column) => column.label)).toEqual(["1K", "2K", "4K"]);
        expect(tokenPriceColumns(split.tokenModels).map((column) => column.label)).toEqual(["≤272K", ">272K"]);
    });
});
