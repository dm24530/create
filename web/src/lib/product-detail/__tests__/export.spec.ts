import { describe, expect, it } from "vitest";

import { buildExportManifest, planSliceRanges } from "@/lib/product-detail/export";
import type { PageSpec } from "@/types/product-detail";

const page: PageSpec = { id: "spec-1", pageId: "page-1", width: 750, height: 1000, background: "#fff", layers: [], overflowStatus: "ok", validation: [] };

describe("product detail export", () => {
    it("plans slices without exceeding the maximum height", () => {
        expect(planSliceRanges(4200, 2000)).toEqual([
            { y: 0, height: 2000 },
            { y: 2000, height: 2000 },
            { y: 4000, height: 200 },
        ]);
    });

    it("builds an export manifest with page dimensions", () => {
        const manifest = buildExportManifest("project-1", "便携榨汁杯", [page]);
        expect(manifest.pageCount).toBe(1);
        expect(manifest.pages[0].width).toBe(750);
        expect(manifest.totalHeight).toBe(1000);
    });
});
