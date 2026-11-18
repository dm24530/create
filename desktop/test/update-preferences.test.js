const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createUpdatePreferences, shouldNotifyUpdate } = require("../src/update-preferences");

function tempPreferencesPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "create-update-preferences-")), "update-preferences.json");
}

test("persists a skipped update version across app restarts", () => {
  const filePath = tempPreferencesPath();
  const first = createUpdatePreferences(filePath);
  first.setSkippedVersion("v0.1.13");

  const restarted = createUpdatePreferences(filePath);
  assert.equal(restarted.getSkippedVersion(), "0.1.13");
  assert.equal(restarted.isVersionSkipped("0.1.13"), true);
  assert.equal(restarted.isVersionSkipped("0.1.14"), false);
});

test("clears a skipped version without damaging other preference files", () => {
  const filePath = tempPreferencesPath();
  const preferences = createUpdatePreferences(filePath);
  preferences.setSkippedVersion("0.1.13");
  preferences.clearSkippedVersion();

  assert.equal(preferences.getSkippedVersion(), "");
  assert.equal(createUpdatePreferences(filePath).getSkippedVersion(), "");
});

test("does not notify for an update version the user skipped", () => {
  assert.equal(
    shouldNotifyUpdate({ status: "available", latestVersion: "0.1.13" }, "0.1.13", false, true, new Set()),
    false,
  );
});

test("notifies for a newer release even after an older version was skipped", () => {
  assert.equal(
    shouldNotifyUpdate({ status: "available", latestVersion: "0.1.14" }, "0.1.13", false, true, new Set()),
    true,
  );
});

test("does not notify while the window is focused or a duplicate was already sent", () => {
  assert.equal(
    shouldNotifyUpdate({ status: "available", latestVersion: "0.1.13" }, "", true, true, new Set()),
    false,
  );
  assert.equal(
    shouldNotifyUpdate({ status: "downloaded", latestVersion: "0.1.13" }, "", false, true, new Set(["downloaded:0.1.13"])),
    false,
  );
});
