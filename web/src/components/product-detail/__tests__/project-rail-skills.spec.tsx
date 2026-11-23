// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/i18n";
import { ProjectRail } from "@/components/product-detail/project-rail";
import type { UserDesignSkill } from "@/types/product-detail";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalMatchMedia = window.matchMedia;

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
});

afterEach(() => {
    window.matchMedia = originalMatchMedia;
});

describe("详情页 Skill 侧栏", () => {
    it("默认收起，展开后列表在固定高度内滚动", async () => {
        const skills = Array.from({ length: 8 }, (_, index): UserDesignSkill => ({
            id: `skill-${index}`,
            userId: 1,
            name: `Skill ${index + 1}`,
            description: "",
            enabled: true,
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
        }));

        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(
                <ProjectRail
                    projects={[]}
                    skills={skills}
                    onSelect={() => {}}
                    onCreate={() => {}}
                    onDelete={() => {}}
                    onOpenSkills={() => {}}
                />,
            );
        });

        const toggle = document.querySelector("[data-skill-toggle]") as HTMLButtonElement | null;
        const list = document.querySelector("[data-skill-list]") as HTMLElement | null;
        expect(toggle?.getAttribute("aria-expanded")).toBe("false");
        expect(list?.hidden).toBe(true);

        await act(async () => toggle?.click());

        expect(toggle?.getAttribute("aria-expanded")).toBe("true");
        expect(list?.hidden).toBe(false);
        expect(list?.classList.contains("overflow-y-auto")).toBe(true);
        expect(list?.classList.contains("max-h-[164px]")).toBe(true);

        await act(async () => root.unmount());
    });
});
