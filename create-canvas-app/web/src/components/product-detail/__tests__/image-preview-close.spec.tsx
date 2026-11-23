// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/i18n";
import { StoryboardPanel } from "@/components/product-detail/storyboard-panel";
import type { ProductDetailAsset, Storyboard } from "@/types/product-detail";

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

describe("商品详情图片预览", () => {
    it("点击图片外的空白区域会关闭预览", async () => {
        const storyboard: Storyboard = {
            id: "storyboard-1",
            revision: 1,
            status: "confirmed",
            pages: [{
                id: "page-1",
                order: 1,
                role: "hero",
                title: "首屏",
                message: "商品主图",
                copy: [],
                visualPrompt: "商品主图",
                negativePrompt: [],
                referenceAssetIds: [],
                factRefs: [],
                layoutTemplateId: "hero",
                status: "ready",
                generatedAssetId: "asset-1",
            }],
        };
        const assets: ProductDetailAsset[] = [{
            id: "asset-1",
            name: "商品图.png",
            kind: "generated",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            mimeType: "image/png",
            createdAt: 1,
        }];

        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(
                <StoryboardPanel
                    storyboard={storyboard}
                    assets={assets}
                    stale={false}
                    imageModelAvailable
                    generatingPageIds={[]}
                    onMove={() => {}}
                    onDelete={() => {}}
                    onConfirm={() => {}}
                    onGenerate={async () => {}}
                    onGenerateAll={async () => {}}
                    onRegenerate={() => {}}
                    generatingAll={false}
                    onRequestChange={() => {}}
                    onUpdatePage={() => {}}
                />,
            );
        });

        const trigger = document.querySelector(".ant-image") as HTMLElement | null;
        expect(trigger).not.toBeNull();
        await act(async () => trigger?.click());

        for (let attempt = 0; attempt < 20 && !document.querySelector(".ant-image-preview"); attempt += 1) {
            await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
        }
        expect(document.querySelector(".ant-image-preview")).not.toBeNull();

        const blankArea = document.querySelector("[data-image-preview-blank]") as HTMLElement | null;
        expect(blankArea).not.toBeNull();
        await act(async () => blankArea?.click());

        expect(document.querySelector(".ant-image-preview")).toBeNull();
        await act(async () => root.unmount());
    });
});
