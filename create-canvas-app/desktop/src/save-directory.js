const path = require("node:path");

function normalizeSaveKind(kind) {
  return kind === "image" || kind === "video" || kind === "canvas" ? kind : "other";
}

function rootDirectoryForKind(settings, kind) {
  if (kind === "image") return settings.imageDir;
  if (kind === "video") return settings.videoDir;
  if (kind === "canvas") return settings.canvasDir;
  return settings.otherDir;
}

function canvasDirectoryForFolder(canvasDir, folder) {
  const value = String(folder || "").trim();
  if (!value || value === "." || value === ".." || path.basename(value) !== value) {
    throw new Error("Canvas folder name is invalid");
  }
  const root = path.resolve(canvasDir);
  const directory = path.resolve(root, value);
  if (directory === root || !directory.startsWith(`${root}${path.sep}`)) {
    throw new Error("Canvas folder is outside the configured directory");
  }
  return directory;
}

function saveDirectoryForKind(settings, kind, canvasFolder) {
  const normalized = normalizeSaveKind(kind);
  if (normalized === "canvas") return canvasDirectoryForFolder(settings.canvasDir, canvasFolder);
  return rootDirectoryForKind(settings, normalized);
}

module.exports = {
  normalizeSaveKind,
  rootDirectoryForKind,
  canvasDirectoryForFolder,
  saveDirectoryForKind,
};