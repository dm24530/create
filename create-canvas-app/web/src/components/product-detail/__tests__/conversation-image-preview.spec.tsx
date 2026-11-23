// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageAttachments } from "@/components/product-detail/conversation-panel";
import type { ProductDetailAsset } from "@/types/product-detail";

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

describe("详情页对话图片", () => {
    it("已发送图片可以点开并在点击空白处后关闭", async () => {
        const asset: ProductDetailAsset = {
            id: "asset-1",
            name: "sent-product.png",
            kind: "product",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            mimeType: "image/png",
            createdAt: 1,
        };

        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<MessageAttachments assetIds={["asset-1"]} allAssets={[asset]} />);
        });

        const image = document.querySelector("img[alt='sent-product.png']") as HTMLImageElement | null;
        expect(image).not.toBeNull();
        await act(async () => image?.click());

        for (let attempt = 0; attempt < 20 && !document.querySelector(".ant-image-preview"); attempt += 1) {
            await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
        }
        const previewLayer = document.querySelector(".ant-image-preview");
        expect(previewLayer).not.toBeNull();
        expect(previewLayer?.classList.contains("aspect-square")).toBe(false);

        const blank = document.querySelector("[data-image-preview-blank]") as HTMLElement | null;
        expect(blank).not.toBeNull();
        await act(async () => blank?.click());
        expect(document.querySelector(".ant-image-preview")).toBeNull();

        await act(async () => root.unmount());
    });
});
