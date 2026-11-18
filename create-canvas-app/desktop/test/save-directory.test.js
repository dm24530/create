const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  rootDirectoryForKind,
  saveDirectoryForKind,
} = require("../src/save-directory");

const root = path.resolve("create-desktop-test-root");
const settings = {
  imageDir: path.join(root, "Images"),
  videoDir: path.join(root, "Videos"),
  canvasDir: path.join(root, "Canvas"),
  otherDir: path.join(root, "Other"),
};

test("settings actions can use the canvas root without a canvas folder", () => {
  assert.equal(rootDirectoryForKind(settings, "canvas"), settings.canvasDir);
});

test("canvas file saves still require a valid child canvas folder", () => {
  assert.equal(
    saveDirectoryForKind(settings, "canvas", "Night City-a1b2c3d4"),
    path.join(settings.canvasDir, "Night City-a1b2c3d4"),
  );
  assert.throws(
    () => saveDirectoryForKind(settings, "canvas"),
    /Canvas folder name is invalid/,
  );
  assert.throws(
    () => saveDirectoryForKind(settings, "canvas", path.join("..", "outside")),
    /Canvas folder name is invalid/,
  );
});
