import { beforeEach, describe, expect, it } from "vitest";

import {
    readSkippedUpdateVersion,
    shouldAutoPromptForUpdate,
    writeSkippedUpdateVersion,
    clearSkippedUpdateVersion,
    type DesktopUpdateState,
} from "../desktop-update";

function updateState(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
    return {
        status: "available",
        currentVersion: "0.1.12",
        latestVersion: "0.1.13",
        notes: "Release notes",
        publishedAt: "2026-11-18",
        minimumVersion: "0.1.0",
        updateBaseUrl: "https://downloads.example.com/create/",
        progress: null,
        error: "",
        ...overrides,
    };
}

describe("desktop update prompt preferences", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("persists the skipped version across hook remounts", () => {
        writeSkippedUpdateVersion("v0.1.13");

        expect(readSkippedUpdateVersion()).toBe("0.1.13");
    });

    it("does not auto-prompt for a skipped version", () => {
        writeSkippedUpdateVersion("0.1.13");

        expect(shouldAutoPromptForUpdate(updateState(), readSkippedUpdateVersion(), "")).toBe(false);
    });

    it("auto-prompts when a newer version appears after an older version was skipped", () => {
        writeSkippedUpdateVersion("0.1.13");

        expect(
            shouldAutoPromptForUpdate(
                updateState({ latestVersion: "0.1.14" }),
                readSkippedUpdateVersion(),
                "",
            ),
        ).toBe(true);
    });

    it("can clear a skipped version", () => {
        writeSkippedUpdateVersion("0.1.13");
        clearSkippedUpdateVersion();

        expect(readSkippedUpdateVersion()).toBe("");
        expect(shouldAutoPromptForUpdate(updateState(), readSkippedUpdateVersion(), "")).toBe(true);
    });

    it("prompts for a manually downloaded update even when that version was previously skipped", () => {
        writeSkippedUpdateVersion("0.1.13");

        expect(
            shouldAutoPromptForUpdate(
                updateState({ status: "downloaded", progress: { percent: 100 } }),
                readSkippedUpdateVersion(),
                "",
            ),
        ).toBe(true);
    });
});
