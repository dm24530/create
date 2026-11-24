// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import { MessageRow } from "@/components/product-detail/conversation-panel";
import type { ProductDetailConversationMessage } from "@/types/product-detail";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = globalThis.ResizeObserver;
const originalGetComputedStyle = window.getComputedStyle;

beforeEach(() => {
    document.body.innerHTML = "";
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    window.getComputedStyle = ((element: Element) => originalGetComputedStyle.call(window, element)) as typeof window.getComputedStyle;
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as typeof ResizeObserver;
});

afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.getComputedStyle = originalGetComputedStyle;
    globalThis.ResizeObserver = originalResizeObserver;
});

describe("商品详情快捷选项", () => {
    it("允许多选，并在点击发送选择后才提交", async () => {
        const message: ProductDetailConversationMessage = {
            id: "assistant-1",
            role: "assistant",
            content: "请选择适用场景",
            createdAt: 1,
            turn: {
                message: "请选择适用场景",
                question: { field: "scenarios", prompt: "适用场景", options: ["主卧", "亲子卧室", "换季收纳"] },
                readyToPlan: false,
                assumptions: [],
                risks: [],
            },
        };
        const onQuickReply = vi.fn();
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);

        await act(async () => {
            root.render(
                <MessageRow
                    message={message}
                    isLatestAssistant
                    showGenerationConfirmation={false}
                    busy={false}
                    hasTextModel
                    allAssets={[]}
                    canRequestNextStep={false}
                    onQuickReply={onQuickReply}
                    onRequestNextStep={() => {}}
                    onAction={() => {}}
                />,
            );
        });

        const buttons = [...document.querySelectorAll("button")];
        const master = buttons.find((button) => button.textContent?.trim() === "主卧") as HTMLButtonElement;
        const child = buttons.find((button) => button.textContent?.trim() === "亲子卧室") as HTMLButtonElement;
        expect(master).toBeTruthy();
        expect(child).toBeTruthy();

        await act(async () => master.click());
        await act(async () => child.click());
        expect(onQuickReply).not.toHaveBeenCalled();

        const submit = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "发送选择") as HTMLButtonElement | undefined;
        expect(submit).toBeTruthy();
        await act(async () => submit?.click());
        expect(onQuickReply).toHaveBeenCalledWith("主卧；亲子卧室");

        await act(async () => root.unmount());
    });

    it("单选问题只保留最后一次选择", async () => {
        const message: ProductDetailConversationMessage = {
            id: "assistant-2",
            role: "assistant",
            content: "这个详情页准备投放到哪个平台？",
            createdAt: 2,
            turn: {
                message: "这个详情页准备投放到哪个平台？",
                question: { field: "platform", prompt: "投放平台", options: ["淘宝/天猫", "京东"], multiple: false },
                readyToPlan: false,
                assumptions: [],
                risks: [],
            },
        };
        const onQuickReply = vi.fn();
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);

        await act(async () => {
            root.render(
                <MessageRow
                    message={message}
                    isLatestAssistant
                    showGenerationConfirmation={false}
                    busy={false}
                    hasTextModel
                    allAssets={[]}
                    canRequestNextStep={false}
                    onQuickReply={onQuickReply}
                    onRequestNextStep={() => {}}
                    onAction={() => {}}
                />,
            );
        });

        const taobao = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "淘宝/天猫") as HTMLButtonElement;
        const jd = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "京东") as HTMLButtonElement;
        await act(async () => taobao.click());
        await act(async () => jd.click());
        expect(taobao.getAttribute("aria-pressed")).toBe("false");
        expect(jd.getAttribute("aria-pressed")).toBe("true");

        const submit = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "发送选择") as HTMLButtonElement | undefined;
        await act(async () => submit?.click());
        expect(onQuickReply).toHaveBeenCalledWith("京东");

        await act(async () => root.unmount());
    });
});