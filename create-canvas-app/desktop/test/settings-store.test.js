const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createDefaultSettings,
  mergeSettings,
  validateSettings,
} = require("../src/settings-store");

const picturesPath = path.resolve("create-desktop-test-root", "Pictures");
const downloadsPath = path.resolve("create-desktop-test-root", "Downloads");

test("creates local save defaults without a configurable web URL", () => {
  const settings = createDefaultSettings({
    picturesPath,
    downloadsPath,
    env: {},
  });

  assert.equal(settings.settingsVersion, 4);
  assert.equal("webUrl" in settings, false);
  assert.equal(settings.imageDir, path.join(picturesPath, "Create", "Images"));
  assert.equal(settings.videoDir, path.join(picturesPath, "Create", "Videos"));
  assert.equal(settings.canvasDir, path.join(picturesPath, "Create", "Canvas"));
  assert.equal(settings.otherDir, path.join(downloadsPath, "Create"));
});

test("merges persisted values over defaults", () => {
  const defaults = createDefaultSettings({ picturesPath, downloadsPath, env: {} });
  const settings = mergeSettings(defaults, {
    imageDir: path.resolve("create-desktop-test-root", "Images"),
    canvasDir: path.resolve("create-desktop-test-root", "Canvas"),
    openFolderAfterSave: true,
  });

  assert.equal(settings.imageDir, path.resolve("create-desktop-test-root", "Images"));
  assert.equal(settings.canvasDir, path.resolve("create-desktop-test-root", "Canvas"));
  assert.equal(settings.openFolderAfterSave, true);
});

test("drops a previously persisted configurable web URL", () => {
  const defaults = createDefaultSettings({ picturesPath, downloadsPath, env: {} });
  const settings = mergeSettings(defaults, {
    webUrl: "https://malicious.example.com",
    imageDir: defaults.imageDir,
    videoDir: defaults.videoDir,
    canvasDir: defaults.canvasDir,
    otherDir: defaults.otherDir,
  });

  assert.equal("webUrl" in settings, false);
});

test("rejects relative directory paths", () => {
  assert.throws(
    () => validateSettings({
      ...createDefaultSettings({ picturesPath, downloadsPath, env: {} }),
      imageDir: "relative/images",
    }),
    /absolute/,
  );
});
