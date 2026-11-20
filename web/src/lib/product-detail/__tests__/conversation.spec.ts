import { describe, expect, it } from "vitest";

import { buildProductDetailConversationMessages, createProductDetailWelcomeMessage, fallbackProductDetailTurn, parseProductDetailAssistantTurn } from "@/lib/product-detail/conversation";
import { createEmptyBrief } from "@/lib/product-detail/brief";

describe("product detail conversation", () => {
    it("parses a fenced structured assistant response", () => {
        const turn = parseProductDetailAssistantTurn('```json\n{"message":"请补充目标人群","readyToPlan":false,"assumptions":[],"risks":[]}\n```');

        expect(turn.message).toBe("请补充目标人群");
        expect(turn.readyToPlan).toBe(false);
    });

    it("parses agent actions and quick-reply questions", () => {
        const turn = parseProductDetailAssistantTurn(JSON.stringify({
            message: "请选择目标平台",
            question: { field: "platform", prompt: "投放到哪个平台？", options: ["淘宝", "京东"] },
            actions: [{ type: "plan_storyboard", label: "生成分镜" }],
            readyToPlan: true,
            assumptions: [],
            risks: [],
        }));
        expect(turn.question?.options).toEqual(["淘宝", "京东"]);
        expect(turn.actions).toEqual([{ type: "plan_storyboard", label: "生成分镜" }]);
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

    it("attaches product images to the current user turn for vision models", () => {
        const result = buildProductDetailConversationMessages({
            brief: createEmptyBrief("taobao"),
            messages: [],
            userMessage: "请分析这张商品图",
            attachments: [{ id: "a1", name: "product.png", type: "image/png", dataUrl: "data:image/png;base64,AAAA", width: 100, height: 100, bytes: 3 }],
        });
        const current = result[result.length - 1];
        expect(Array.isArray(current.content)).toBe(true);
        expect(current.content).toEqual(expect.arrayContaining([
            { type: "text", text: "请分析这张商品图" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ]));
    });
    it("asks for the product name first when the brief is empty", () => {
        const turn = fallbackProductDetailTurn(createEmptyBrief("jd"));
        expect(turn.message).toContain("商品名称");
        expect(turn.readyToPlan).toBe(false);
    });
    it("creates an assistant welcome turn that starts discovery in chat", () => {
        const welcome = createProductDetailWelcomeMessage(123);

        expect(welcome.role).toBe("assistant");
        expect(welcome.createdAt).toBe(123);
        expect(welcome.turn?.question?.field).toBe("platform");
        expect(welcome.turn?.question?.options).toEqual(["淘宝/天猫", "京东", "拼多多"]);
        expect(welcome.content).toContain("商品图");
    });

    it("sanitizes model brief patches and invalid platform values", () => {
        const turn = parseProductDetailAssistantTurn(JSON.stringify({
            message: "已记录",
            briefPatch: {
                productName: "便携咖啡杯",
                platform: "京东",
                targetAudience: ["通勤人群", "通勤人群", " "],
                pricePosition: "premium",
                revision: 99,
                unexpected: "ignored",
            },
            readyToPlan: false,
            assumptions: [],
            risks: [],
        }));

        expect(turn.briefPatch).toEqual({
            productName: "便携咖啡杯",
            targetAudience: ["通勤人群"],
            pricePosition: "premium",
        });
    });

    it("drops duplicate and unknown agent actions", () => {
        const turn = parseProductDetailAssistantTurn(JSON.stringify({
            message: "下一步",
            actions: [
                { type: "plan_storyboard", label: "生成分镜" },
                { type: "plan_storyboard", label: "重复动作" },
                { type: "delete_project" },
            ],
            readyToPlan: true,
            assumptions: [],
            risks: [],
        }));

        expect(turn.actions).toEqual([{ type: "plan_storyboard", label: "生成分镜" }]);
    });
});
