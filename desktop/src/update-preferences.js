const fs = require("node:fs");
const path = require("node:path");

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function shouldNotifyUpdate(state, skippedVersion, focused, notificationSupported, notifiedKeys) {
  if (!state || (state.status !== "available" && state.status !== "downloaded")) return false;
  if (!notificationSupported || focused) return false;
  const latestVersion = normalizeVersion(state.latestVersion);
  if (!latestVersion || normalizeVersion(skippedVersion) === latestVersion) return false;
  return !notifiedKeys.has(`${state.status}:${latestVersion}`);
}

function createUpdatePreferences(filePath) {
  let skippedVersion = "";

  try {
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
    skippedVersion = normalizeVersion(stored?.skippedVersion);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("Failed to load desktop update preferences:", error);
    }
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ skippedVersion }, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  }

  return {
    getSkippedVersion: () => skippedVersion,
    setSkippedVersion(value) {
      skippedVersion = normalizeVersion(value);
      persist();
      return skippedVersion;
    },
    clearSkippedVersion() {
      skippedVersion = "";
      persist();
    },
    isVersionSkipped(value) {
      const version = normalizeVersion(value);
      return Boolean(version && skippedVersion && version === skippedVersion);
    },
  };
}

module.exports = { createUpdatePreferences, shouldNotifyUpdate };
