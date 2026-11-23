const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  UPDATE_STATUS,
  compareVersions,
  normalizeReleaseMetadata,
  resolveUpdateFeedUrl,
  createDesktopUpdateService,
} = require("../src/update-service");

test("compareVersions orders semantic versions", () => {
  assert.equal(compareVersions("0.20.1", "0.20.0"), 1);
  assert.equal(compareVersions("v0.20.1", "0.20.1"), 0);
  assert.equal(compareVersions("0.19.9", "0.20.0"), -1);
});

test("normalizeReleaseMetadata returns available update with notes", () => {
  const result = normalizeReleaseMetadata(
    {
      code: 0,
      data: {
        enabled: true,
        version: "0.21.0",
        published_at: "2026-11-18",
        minimum_version: "0.20.0",
        notes: "新增更新提醒\n修复若干问题",
        update_base_url: "https://downloads.example.com/create/",
      },
    },
    "0.20.0",
  );

  assert.equal(result.status, UPDATE_STATUS.AVAILABLE);
  assert.equal(result.latestVersion, "0.21.0");
  assert.equal(result.notes, "新增更新提醒\n修复若干问题");
  assert.equal(result.updateBaseUrl, "https://downloads.example.com/create/");
});

test("normalizeReleaseMetadata rejects missing update feed URL", () => {
  const result = normalizeReleaseMetadata(
    {
      enabled: true,
      version: "0.21.0",
      notes: "test",
      update_base_url: "",
    },
    "0.20.0",
  );

  assert.equal(result.status, UPDATE_STATUS.ERROR);
  assert.match(result.error, /update_base_url/);
});

test("resolves architecture-specific update feeds", () => {
  assert.equal(
    resolveUpdateFeedUrl("https://downloads.example.com/create/", "win32", "x64"),
    "https://downloads.example.com/create/windows/x64",
  );
  assert.equal(
    resolveUpdateFeedUrl("https://downloads.example.com/create/", "win32", "arm64"),
    "https://downloads.example.com/create/windows/arm64",
  );
  assert.equal(
    resolveUpdateFeedUrl("https://downloads.example.com/create/", "darwin", "arm64"),
    "https://downloads.example.com/create/macos/arm64",
  );
  assert.equal(
    resolveUpdateFeedUrl("https://downloads.example.com/create/", "darwin", "x64"),
    "https://downloads.example.com/create/macos/x64",
  );
});

test("desktop update service never enables silent download", () => {
  const autoUpdater = new EventEmitter();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.checkForUpdates = async () => ({ updateInfo: { version: "0.21.0" } });
  autoUpdater.downloadUpdate = async () => [];
  autoUpdater.quitAndInstall = () => undefined;
  autoUpdater.setFeedURL = () => undefined;

  const service = createDesktopUpdateService({
    app: { isPackaged: true, getVersion: () => "0.20.0" },
    autoUpdater,
    net: { fetch: async () => ({ ok: true, json: async () => ({ data: { enabled: true, version: "0.21.0", notes: "notes", update_base_url: "https://downloads.example.com/create/" } }) }) },
    onStateChange: () => undefined,
    platform: "win32",
  });

  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(service.getState().status, UPDATE_STATUS.IDLE);
});

test("desktop update service checks, downloads, and installs only after explicit calls", async () => {
  const autoUpdater = new EventEmitter();
  let feedUrl = "";
  let installed = false;
  autoUpdater.checkForUpdates = async () => {
    autoUpdater.emit("update-available", { version: "0.21.0" });
    return { updateInfo: { version: "0.21.0" } };
  };
  autoUpdater.downloadUpdate = async () => {
    autoUpdater.emit("download-progress", { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 });
    autoUpdater.emit("update-downloaded", { version: "0.21.0" });
    return [];
  };
  autoUpdater.setFeedURL = (options) => { feedUrl = options.url; };
  autoUpdater.quitAndInstall = () => { installed = true; };

  const states = [];
  const service = createDesktopUpdateService({
    app: { isPackaged: true, getVersion: () => "0.20.0" },
    autoUpdater,
    net: { fetch: async () => ({ ok: true, json: async () => ({ data: { enabled: true, version: "0.21.0", notes: "notes", update_base_url: "https://downloads.example.com/create/" } }) }) },
    onStateChange: (state) => states.push(state.status),
    platform: "win32",
    arch: "x64",
  });

  const checked = await service.checkForUpdates("https://api.example.com/api/v1/public/create-client-release");
  assert.equal(checked.status, UPDATE_STATUS.AVAILABLE);
  assert.equal(feedUrl, "https://downloads.example.com/create/windows/x64");
  assert.equal(states.includes(UPDATE_STATUS.DOWNLOADING), false);

  await service.downloadUpdate();
  assert.equal(service.getState().status, UPDATE_STATUS.DOWNLOADED);
  assert.equal(installed, false);

  service.installUpdate();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(installed, true);
});

test("server metadata alone is not enough when the update manifest still has the old version", async () => {
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = async () => {
    autoUpdater.emit("update-not-available", { version: "0.1.0" });
    return { updateInfo: { version: "0.1.0" } };
  };
  autoUpdater.setFeedURL = () => undefined;

  const service = createDesktopUpdateService({
    app: { isPackaged: true, getVersion: () => "0.1.0" },
    autoUpdater,
    net: { fetch: async () => ({ ok: true, json: async () => ({ data: { enabled: true, version: "0.1.1", notes: "new", update_base_url: "https://downloads.example.com/create/" } }) }) },
    onStateChange: () => undefined,
    platform: "win32",
  });

  const checked = await service.checkForUpdates("https://api.example.com/api/v1/public/create-client-release");
  assert.equal(checked.status, UPDATE_STATUS.CURRENT);
  assert.equal(checked.latestVersion, "0.1.0");
});

test("desktop update service creates a runtime app-update config for downloads", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-update-config-"));
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = async () => ({ updateInfo: { version: "0.1.1" } });
  autoUpdater.setFeedURL = () => undefined;

  const service = createDesktopUpdateService({
    app: { isPackaged: true, getVersion: () => "0.1.0", getPath: () => tempDir },
    autoUpdater,
    net: { fetch: async () => ({ ok: true, json: async () => ({ data: { enabled: true, version: "0.1.1", notes: "new", update_base_url: "https://downloads.example.com/create/" } }) }) },
    onStateChange: () => undefined,
    platform: "win32",
  });

  await service.checkForUpdates("https://api.example.com/api/v1/public/create-client-release");
  assert.ok(autoUpdater.updateConfigPath, "updateConfigPath should be configured");
  assert.ok(fs.existsSync(autoUpdater.updateConfigPath), "runtime app-update.yml should exist");
  const config = fs.readFileSync(autoUpdater.updateConfigPath, "utf8");
  assert.match(config, /provider: generic/);
  assert.match(config, /updaterCacheDirName:/);
});

test("desktop update logger ignores broken stdout pipes", () => {
  const autoUpdater = new EventEmitter();
  createDesktopUpdateService({
    app: { isPackaged: true, getVersion: () => "0.1.0" },
    autoUpdater,
    net: { fetch: async () => ({ ok: true, json: async () => ({}) }) },
    onStateChange: () => undefined,
    platform: "win32",
  });

  const originalInfo = console.info;
  console.info = () => { throw new Error("EPIPE: broken pipe, write"); };
  try {
    assert.doesNotThrow(() => autoUpdater.logger.info("install on explicit quitAndInstall"));
  } finally {
    console.info = originalInfo;
  }
});
