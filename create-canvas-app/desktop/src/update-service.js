const { URL } = require("node:url");

const UPDATE_STATUS = Object.freeze({
  IDLE: "idle",
  CHECKING: "checking",
  AVAILABLE: "available",
  CURRENT: "current",
  DOWNLOADING: "downloading",
  DOWNLOADED: "downloaded",
  ERROR: "error",
  UNSUPPORTED: "unsupported",
});

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function versionParts(value) {
  const match = normalizeVersion(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeReleaseMetadata(payload, currentVersion) {
  const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object" ? payload.data : payload;
  const current = normalizeVersion(currentVersion) || "0.0.0";
  if (!data || typeof data !== "object") {
    return { status: UPDATE_STATUS.ERROR, currentVersion: current, error: "invalid release metadata" };
  }

  const latestVersion = normalizeVersion(data.version);
  const notes = String(data.notes || "").trim();
  const publishedAt = String(data.published_at || "").trim();
  const minimumVersion = normalizeVersion(data.minimum_version);
  const updateBaseUrl = String(data.update_base_url || "").trim();
  const available = data.enabled === true && Boolean(versionParts(latestVersion));

  if (!available || compareVersions(latestVersion, current) <= 0) {
    return {
      status: UPDATE_STATUS.CURRENT,
      currentVersion: current,
      latestVersion: available ? latestVersion : current,
      notes,
      publishedAt,
      minimumVersion,
      updateBaseUrl,
    };
  }

  if (!isHttpUrl(updateBaseUrl)) {
    return {
      status: UPDATE_STATUS.ERROR,
      currentVersion: current,
      latestVersion,
      notes,
      publishedAt,
      minimumVersion,
      updateBaseUrl,
      error: "update_base_url is not configured",
    };
  }

  return {
    status: UPDATE_STATUS.AVAILABLE,
    currentVersion: current,
    latestVersion,
    notes,
    publishedAt,
    minimumVersion,
    updateBaseUrl,
  };
}

function createDesktopUpdateService(options) {
  const {
    app,
    autoUpdater,
    net,
    onStateChange,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    intervalMs = 4 * 60 * 60 * 1000,
    platform = process.platform,
  } = options;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  let state = {
    status: UPDATE_STATUS.IDLE,
    currentVersion: normalizeVersion(app.getVersion()),
    latestVersion: normalizeVersion(app.getVersion()),
    notes: "",
    publishedAt: "",
    minimumVersion: "",
    updateBaseUrl: "",
    progress: null,
    error: "",
  };
  let latestMetadata = null;
  let downloadRequested = false;
  let timer = null;

  function publish(next) {
    state = {
      ...state,
      ...next,
      currentVersion: normalizeVersion(next.currentVersion || state.currentVersion || app.getVersion()),
    };
    try {
      onStateChange?.(state);
    } catch (error) {
      console.error("Failed to publish desktop update state:", error);
    }
    return state;
  }

  function eventState(status, payload = {}) {
    return publish({
      ...payload,
      status,
      error: payload.error || "",
      progress: payload.progress ?? state.progress,
    });
  }

  autoUpdater.on("checking-for-update", () => eventState(UPDATE_STATUS.CHECKING));
  autoUpdater.on("update-available", (info) => {
    const latestVersion = normalizeVersion(info?.version || latestMetadata?.latestVersion);
    const isExpectedVersion = !latestMetadata?.latestVersion || compareVersions(latestVersion, latestMetadata.latestVersion) === 0;
    eventState(UPDATE_STATUS.AVAILABLE, {
      latestVersion,
      notes: isExpectedVersion ? latestMetadata?.notes || state.notes : state.notes,
      publishedAt: isExpectedVersion ? latestMetadata?.publishedAt || state.publishedAt : state.publishedAt,
      minimumVersion: isExpectedVersion ? latestMetadata?.minimumVersion || state.minimumVersion : state.minimumVersion,
      updateBaseUrl: latestMetadata?.updateBaseUrl || state.updateBaseUrl,
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    eventState(UPDATE_STATUS.CURRENT, {
      latestVersion: normalizeVersion(info?.version || state.currentVersion),
      progress: null,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    eventState(UPDATE_STATUS.DOWNLOADING, {
      progress: {
        percent: Math.max(0, Math.min(100, Number(progress?.percent || 0))),
        transferred: Number(progress?.transferred || 0),
        total: Number(progress?.total || 0),
        bytesPerSecond: Number(progress?.bytesPerSecond || 0),
      },
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    downloadRequested = false;
    eventState(UPDATE_STATUS.DOWNLOADED, {
      latestVersion: normalizeVersion(info?.version || state.latestVersion),
      progress: { percent: 100 },
    });
  });
  autoUpdater.on("error", (error) => {
    downloadRequested = false;
    eventState(UPDATE_STATUS.ERROR, {
      error: error instanceof Error ? error.message : String(error || "update failed"),
    });
  });

  async function fetchMetadata(metadataUrl) {
    if (!isHttpUrl(metadataUrl)) throw new Error("Invalid update metadata URL");
    const response = await net.fetch(metadataUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Update metadata request failed (HTTP ${response.status})`);
    return response.json();
  }

  async function checkForUpdates(metadataUrl) {
    if (!app.isPackaged) {
      return publish({
        status: UPDATE_STATUS.UNSUPPORTED,
        currentVersion: app.getVersion(),
        latestVersion: app.getVersion(),
        error: "updates are available only in packaged builds",
      });
    }
    if (platform !== "win32" && platform !== "darwin") {
      return publish({
        status: UPDATE_STATUS.UNSUPPORTED,
        currentVersion: app.getVersion(),
        latestVersion: app.getVersion(),
        error: "updates are supported on Windows and macOS only",
      });
    }

    eventState(UPDATE_STATUS.CHECKING, { error: "", progress: null });
    try {
      const metadata = normalizeReleaseMetadata(await fetchMetadata(metadataUrl), app.getVersion());
      latestMetadata = metadata;
      if (metadata.status !== UPDATE_STATUS.AVAILABLE) {
        return publish({ ...metadata, progress: null, error: metadata.error || "" });
      }

      autoUpdater.setFeedURL({ provider: "generic", url: metadata.updateBaseUrl });
      const result = await autoUpdater.checkForUpdates();
      const infoVersion = normalizeVersion(result?.updateInfo?.version || metadata.latestVersion);
      if (compareVersions(infoVersion, app.getVersion()) <= 0) {
        return publish({ ...metadata, status: UPDATE_STATUS.CURRENT, latestVersion: infoVersion, progress: null });
      }
      return publish({ ...metadata, latestVersion: infoVersion, status: UPDATE_STATUS.AVAILABLE });
    } catch (error) {
      return eventState(UPDATE_STATUS.ERROR, {
        error: error instanceof Error ? error.message : String(error),
        progress: null,
      });
    }
  }

  async function downloadUpdate() {
    if (state.status !== UPDATE_STATUS.AVAILABLE) throw new Error("No update is available to download");
    if (downloadRequested) return true;
    downloadRequested = true;
    eventState(UPDATE_STATUS.DOWNLOADING, {
      error: "",
      progress: state.progress || { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
    });
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      downloadRequested = false;
      eventState(UPDATE_STATUS.ERROR, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  function installUpdate() {
    if (state.status !== UPDATE_STATUS.DOWNLOADED) throw new Error("The update has not finished downloading");
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  }

  function startPeriodicCheck(metadataUrl) {
    if (timer) clearIntervalFn(timer);
    timer = setIntervalFn(() => void checkForUpdates(metadataUrl), intervalMs);
    return () => {
      if (timer) clearIntervalFn(timer);
      timer = null;
    };
  }

  return { checkForUpdates, downloadUpdate, installUpdate, startPeriodicCheck, getState: () => state };
}

module.exports = {
  UPDATE_STATUS,
  compareVersions,
  normalizeReleaseMetadata,
  createDesktopUpdateService,
};
