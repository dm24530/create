const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildSavePath,
  classifyDownload,
  sanitizeFilename,
} = require("../src/download-policy");

test("classifies image and video downloads by MIME type and extension", () => {
  assert.equal(classifyDownload("result.bin", "image/png"), "image");
  assert.equal(classifyDownload("result.webm", "application/octet-stream"), "video");
  assert.equal(classifyDownload("result.JPEG", ""), "image");
  assert.equal(classifyDownload("result.MP4", ""), "video");
  assert.equal(classifyDownload("archive.zip", "application/zip"), "other");
});

test("sanitizes unsafe filename characters without losing the extension", () => {
  assert.equal(sanitizeFilename('../bad:name?.png'), "bad_name_.png");
  assert.equal(sanitizeFilename("   "), "download");
});

test("buildSavePath avoids overwriting an existing file", () => {
  const directory = path.join("C:", "Users", "tester", "Pictures", "Create");
  const existing = new Set([
    path.join(directory, "image.png"),
    path.join(directory, "image-20261114-123456-1.png"),
  ]);
  const result = buildSavePath({
    directory,
    filename: "image.png",
    exists: (candidate) => existing.has(candidate),
    now: new Date("2026-11-14T12:34:56.000Z"),
  });

  assert.equal(result, path.join(directory, "image-20261114-123456-2.png"));
});

test("buildSavePath creates a safe path inside the selected directory", () => {
  const directory = path.join("C:", "Users", "tester", "Videos", "Create");
  const result = buildSavePath({
    directory,
    filename: "../../clip.mp4",
    exists: () => false,
    now: new Date("2026-11-14T12:34:56.000Z"),
  });

  assert.equal(result, path.join(directory, "clip.mp4"));
});
