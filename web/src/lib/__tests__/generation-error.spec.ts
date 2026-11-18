import { describe, expect, it } from "vitest";

import { generationFailureReason } from "@/lib/generation-error";

describe("generationFailureReason", () => {
    it("keeps the actual Error message", () => {
        expect(generationFailureReason(new Error("内容审核未通过"), "生成失败")).toBe("内容审核未通过");
    });

    it("reads an upstream error object", () => {
        expect(generationFailureReason({ error: { message: "上游额度不足" } }, "生成失败")).toBe("上游额度不足");
    });

    it("unwraps a serialized API error", () => {
        expect(generationFailureReason('{"msg":"模型暂不可用"}', "生成失败")).toBe("模型暂不可用");
    });

    it("uses the fallback only when no useful reason exists", () => {
        expect(generationFailureReason({}, "未获取到具体失败原因")).toBe("未获取到具体失败原因");
    });
});
