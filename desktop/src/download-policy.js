const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

const VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".webm",
]);

function classifyDownload(filename, mimeType) {
  const normalizedMime = String(mimeType || "").toLowerCase();
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("video/")) return "video";

  const extension = path.extname(String(filename || "")).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return "other";
}

function sanitizeFilename(filename, fallback = "download") {
  const base = path.basename(String(filename || "").trim());
  const safe = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return safe || fallback;
}

function buildSavePath({ directory, filename, exists, now = new Date() }) {
  const safeName = sanitizeFilename(filename);
  const direct = path.join(directory, safeName);
  if (!exists(direct)) return direct;

  const extension = path.extname(safeName);
  const stem = path.basename(safeName, extension);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  for (let counter = 1; counter < 10000; counter += 1) {
    const candidate = path.join(directory, `${stem}-${stamp}-${counter}${extension}`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error("unable to find an available download filename");
}

module.exports = {
  buildSavePath,
  classifyDownload,
  sanitizeFilename,
};
