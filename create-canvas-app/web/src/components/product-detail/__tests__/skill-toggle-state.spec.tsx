// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/i18n";
import { SkillManagerModal } from "@/components/product-detail/skill-manager";
import type { UserDesignSkill } from "@/types/product-detail";

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

function skill(id: string, name: string, enabled: boolean): UserDesignSkill {
    return {
        id,
        userId: 1,
        name,
        description: "测试 Skill",
        enabled,
        scope: "category",
        category: "家纺",
        brand: { colors: [], fonts: [], visualTone: [] },
        copy: { tone: [], preferredPhrases: [], forbiddenPhrases: [], density: "balanced" },
        layout: { preferredTemplates: [] },
        pagePatterns: [],
        categoryKnowledge: [],
        complianceRules: [],
        referenceAssetIds: [],
        sourceProjectIds: [],
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    };
}

describe("Skill 启用状态", () => {
    it("开启和关闭状态有明确颜色和文字", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(
                <SkillManagerModal
                    open
                    skills={[skill("enabled", "已启用 Skill", true), skill("disabled", "已关闭 Skill", false)]}
                    projectSkillIds={[]}
                    canCreateProjectSkill={false}
                    onClose={() => {}}
                    onToggle={() => {}}
                    onDelete={() => {}}
                    onCreateFromProject={() => {}}
                    onCreateCustom={() => {}}
                    onUpdateSkill={() => {}}
                    onAttach={() => {}}
                />,
            );
        });

        for (let attempt = 0; attempt < 20 && !document.querySelector("[data-skill-state='on']"); attempt += 1) {
            await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
        }

        const enabled = document.querySelector("[data-skill-state='on']") as HTMLElement | null;
        const disabled = document.querySelector("[data-skill-state='off']") as HTMLElement | null;
        expect(enabled?.textContent?.trim()).toBe("已开启");
        expect(disabled?.textContent?.trim()).toBe("已关闭");
        expect(enabled?.getAttribute("aria-checked")).toBe("true");
        expect(disabled?.getAttribute("aria-checked")).toBe("false");

        await act(async () => root.unmount());
    });
});
