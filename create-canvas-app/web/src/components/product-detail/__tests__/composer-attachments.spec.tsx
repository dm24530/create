// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import { ConversationPanel } from "@/components/product-detail/conversation-panel";
import type { ProductBrief, ProductDetailAsset } from "@/types/product-detail";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = globalThis.ResizeObserver;
const originalGetComputedStyle = window.getComputedStyle;
const originalScrollTo = HTMLElement.prototype.scrollTo;

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
    HTMLElement.prototype.scrollTo = () => {};
});

afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.getComputedStyle = originalGetComputedStyle;
    globalThis.ResizeObserver = originalResizeObserver;
    HTMLElement.prototype.scrollTo = originalScrollTo;
});

describe("详情页输入框附件", () => {
    it("图片悬浮在输入框上方，可放大，并且移除按钮不会关闭或撑开输入框", async () => {
        const asset: ProductDetailAsset = {
            id: "asset-1",
            name: "composer-product.png",
            kind: "product",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            mimeType: "image/png",
            createdAt: 1,
        };
        const brief: ProductBrief = {
            productName: "白色四件套",
            category: "家纺",
            description: "",
            sellingPoints: [],
            targetAudience: [],
            scenarios: [],
            platform: "taobao",
            visualStyle: [],
            colorPreference: [],
            copyTone: [],
            forbiddenContent: [],
            referenceAssetIds: [],
            productAssetIds: ["asset-1"],
            requiredModules: [],
            assumptions: [],
            revision: 1,
        };
        const onRemoveAttachment = vi.fn();

        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(
                <ConversationPanel
                    messages={[{ id: "message-1", role: "user", content: "继续补充", createdAt: 1 }]}
                    value=""
                    busy={false}
                    storyboardBusy={false}
                    canPlan={false}
                    storyboardStale={false}
                    projectName="测试项目"
                    projectStatus="discovery"
                    brief={brief}
                    detailsOpen={false}
                    models={[{ value: "text-model", label: "文本模型" }]}
                    modelValue="text-model"
                    imageModels={[]}
                    imageModelValue=""
                    attachments={[asset]}
                    allAssets={[asset]}
                    uploading={false}
                    operation={null}
                    showGenerationConfirmation={false}
                    onConfirmGeneration={() => {}}
                    onContinueEditing={() => {}}
                    onSupplement={() => {}}
                    onToggleDetails={() => {}}
                    focusToken={0}
                    onChange={() => {}}
                    onModelChange={() => {}}
                    onImageModelChange={() => {}}
                    onUpload={() => {}}
                    onRemoveAttachment={onRemoveAttachment}
                    onSend={() => {}}
                    onGenerateStoryboard={() => {}}
                    onOpenStoryboard={() => {}}
                    onQuickReply={() => {}}
                    onAction={() => {}}
                />,
            );
        });

        const overlay = document.querySelector("[data-composer-attachments]") as HTMLElement | null;
        expect(overlay).not.toBeNull();
        expect(overlay?.classList.contains("absolute")).toBe(true);
        expect(overlay?.classList.contains("bottom-full")).toBe(true);

        const image = document.querySelector("img[alt='composer-product.png']") as HTMLImageElement | null;
        expect(image).not.toBeNull();
        await act(async () => image?.click());
        expect(document.querySelector(".ant-image-preview")).not.toBeNull();
        await act(async () => document.querySelector("[data-image-preview-blank]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

        const remove = document.querySelector("[data-remove-attachment='asset-1']") as HTMLButtonElement | null;
        expect(remove).not.toBeNull();
        await act(async () => remove?.click());
        expect(onRemoveAttachment).toHaveBeenCalledWith("asset-1");
        expect(document.querySelector(".ant-image-preview")).toBeNull();

        await act(async () => root.unmount());
    });
});
