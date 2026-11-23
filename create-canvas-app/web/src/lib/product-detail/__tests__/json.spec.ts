import { describe, expect, it } from "vitest";

import { extractFirstJsonObject } from "@/lib/product-detail/json";

describe("product detail JSON extraction", () => {
    it("extracts a balanced object before trailing explanation", () => {
        expect(extractFirstJsonObject('{"message":"包含 } 和 { 的文本"}\n额外说明')).toBe('{"message":"包含 } 和 { 的文本"}');
    });

    it("returns null when no complete object exists", () => {
        expect(extractFirstJsonObject("没有 JSON")).toBeNull();
        expect(extractFirstJsonObject('{"message":"未闭合')).toBeNull();
    });
});