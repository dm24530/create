import { describe, expect, it, vi } from "vitest";

import { createEmptyBrief } from "@/lib/product-detail/brief";
import { createEmptySkill } from "@/lib/product-detail/defaults";
import { createFallbackStoryboard } from "@/lib/product-detail/storyboard";
import type { ProductDetailProject, ProductDetailWorkspace } from "@/types/product-detail";

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => undefined),
            removeItem: vi.fn(async () => undefined),
        }),
    },
}));

import { compactProductDetailWorkspaceForMirror } from "@/services/product-detail/storage";

describe("product detail localStorage mirror", () => {
    it("keeps only a bounded recovery snapshot", () => {
        const brief = {
            ...createEmptyBrief("taobao"),
            productName: "便携榨汁杯",
            revision: 3,
        };
        const storyboard = createFallbackStoryboard(brief, createEmptySkill(1));
        storyboard.pages[0] = { ...storyboard.pages[0], visualPrompt: "长提示词".repeat(1000) };
        const project: ProductDetailProject = {
            id: "project-1",
            userId: 1,
            name: "便携榨汁杯",
            status: "storyboard_confirmed",
            platform: "taobao",
            brief,
            skillIds: [],
            conversationId: "conversation-1",
            messages: Array.from({ length: 80 }, (_, index) => ({
                id: `message-${index}`,
                role: index % 2 ? "assistant" as const : "user" as const,
                content: `message-${index}`,
                createdAt: index,
            })),
            storyboard,
            pageSpecs: [],
            assets: [{
                id: "asset-1",
                name: "source.png",
                kind: "product",
                storageKey: "asset-1",
                url: "blob:source",
                mimeType: "image/png",
                createdAt: Date.now(),
            }],
            createdAt: 1,
            updatedAt: 1,
        };
        const workspace: ProductDetailWorkspace = {
            version: 1,
            projects: [project],
            skills: [],
            activeProjectId: project.id,
            updatedAt: Date.now(),
        };

        const compact = compactProductDetailWorkspaceForMirror(workspace);

        expect(compact.projects[0].messages).toHaveLength(50);
        expect(compact.projects[0].assets[0].url).toBeUndefined();
        expect(compact.projects[0].storyboard?.pages[0].visualPrompt.length).toBeLessThanOrEqual(800);
        expect(compact.projects[0].pageSpecs).toEqual([]);
    });
});
