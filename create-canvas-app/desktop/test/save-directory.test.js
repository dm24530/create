const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  rootDirectoryForKind,
  saveDirectoryForKind,
} = require("../src/save-directory");

const settings = {
  imageDir: path.join("C:", "Create", "Images"),
  videoDir: path.join("C:", "Create", "Videos"),
  canvasDir: path.join("C:", "Create", "Canvas"),
  otherDir: path.join("C:", "Create", "Other"),
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
    () => saveDirectoryForKind(settings, "canvas", "..\\outside"),
    /Canvas folder name is invalid/,
  );
});