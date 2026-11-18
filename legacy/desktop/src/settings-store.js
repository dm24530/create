const path = require("node:path");

const SETTINGS_VERSION = 3;

function normalizeDirectory(raw, fieldName) {
  const value = String(raw || "").trim();
  if (!value) throw new Error(`${fieldName} cannot be empty`);
  if (!path.isAbsolute(value)) throw new Error(`${fieldName} must be an absolute directory path`);
  return path.normalize(value);
}

function createDefaultSettings({ picturesPath, downloadsPath, env = process.env }) {
  return {
    settingsVersion: SETTINGS_VERSION,
    imageDir: path.join(picturesPath, "Create", "Images"),
    videoDir: path.join(picturesPath, "Create", "Videos"),
    otherDir: path.join(downloadsPath, "Create"),
    openFolderAfterSave: false,
  };
}

function mergeSettings(defaults, persisted) {
  const candidate = {
    ...defaults,
    ...(persisted && typeof persisted === "object" ? persisted : {}),
  };
  return validateSettings(candidate);
}

function validateSettings(settings) {
  return {
    settingsVersion: SETTINGS_VERSION,
    imageDir: normalizeDirectory(settings.imageDir, "Image directory"),
    videoDir: normalizeDirectory(settings.videoDir, "Video directory"),
    otherDir: normalizeDirectory(settings.otherDir, "Other download directory"),
    openFolderAfterSave: Boolean(settings.openFolderAfterSave),
  };
}

module.exports = {
  createDefaultSettings,
  mergeSettings,
  validateSettings,
};
