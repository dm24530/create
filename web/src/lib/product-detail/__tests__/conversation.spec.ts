import { describe, expect, it } from "vitest";

import { buildProductDetailConversationMessages, fallbackProductDetailTurn, parseProductDetailAssistantTurn } from "@/lib/product-detail/conversation";
import { createEmptyBrief } from "@/lib/product-detail/brief";

describe("product detail conversation", () => {
    it("parses a fenced structured assistant response", () => {
        const turn = parseProductDetailAssistantTurn('```json\n{"message":"请补充目标人群","readyToPlan":false,"assumptions":[],"risks":[]}\n```');

        expect(turn.message).toBe("请补充目标人群");
        expect(turn.readyToPlan).toBe(false);
    });

    it("returns a safe retry message for malformed output", () => {
        const turn = parseProductDetailAssistantTurn("not json");

        expect(turn.message).toContain("重新整理");
        expect(turn.readyToPlan).toBe(false);
    });

    it("limits conversation context and includes the selected skill", () => {
        const messages = Array.from({ length: 16 }, (_, index) => ({
            id: `m-${index}`,
            role: index % 2 === 0 ? "user" as const : "assistant" as const,
            content: `message-${index}`,
            createdAt: index,
        }));
        const result = buildProductDetailConversationMessages({
            brief: createEmptyBrief("taobao"),
            messages,
            skill: {
                id: "s1", userId: 1, name: "清爽风格", description: "", enabled: true, scope: "global",
                brand: { colors: ["#fff"], fonts: [], visualTone: ["清爽"] },
                copy: { tone: ["直接"], preferredPhrases: [], forbiddenPhrases: [], density: "balanced" },
                layout: { preferredTemplates: [] }, pagePatterns: [], categoryKnowledge: [], complianceRules: [],
                referenceAssetIds: [], sourceProjectIds: [], revision: 1, createdAt: 1, updatedAt: 1,
            },
        });

        expect(result[0].role).toBe("system");
        expect(result[0].content).toContain("清爽风格");
        expect(result.filter((item) => item.role !== "system")).toHaveLength(10);
    });

    it("asks for the product name first when the brief is empty", () => {
        const turn = fallbackProductDetailTurn(createEmptyBrief("jd"));
        expect(turn.message).toContain("商品名称");
        expect(turn.readyToPlan).toBe(false);
    });
});
