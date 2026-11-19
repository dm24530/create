import { beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { formatPreciseDuration } from "@/lib/image-utils";

describe("precise image duration formatting", () => {
    beforeAll(async () => {
        await i18n.changeLanguage("zh-CN");
    });

    it("keeps sub-second compression durations visible", () => {
        expect(formatPreciseDuration(802)).toBe("0.8秒");
    });

    it("keeps a decimal for short generation durations", () => {
        expect(formatPreciseDuration(57_713)).toBe("57.7秒");
    });

    it("keeps a decimal in minute durations", () => {
        expect(formatPreciseDuration(61_828)).toBe("1分01.8秒");
    });
});
