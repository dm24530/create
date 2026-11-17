const { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  APP_ORIGIN,
  PARTITION,
  isAllowedExternalUrl,
  isTrustedRuntimeUrl,
  resolveAppAssetPath,
  secureWindowOptions,
} = require("./security");
const { buildSavePath, classifyDownload } = require("./download-policy");
const { createDefaultSettings, mergeSettings, validateSettings } = require("./settings-store");
const { normalizeSaveKind, rootDirectoryForKind, saveDirectoryForKind } = require("./save-directory");
const { createDesktopUpdateService, UPDATE_STATUS } = require("./update-service");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let mainWindow = null;
let settings = null;
let desktopUpdater = null;
const notifiedUpdateKeys = new Set();
const smokeMode = process.env.CREATE_CANVAS_SMOKE === "1";

if (process.env.CREATE_CANVAS_USER_DATA_PATH) {
  app.setPath("userData", path.resolve(process.env.CREATE_CANVAS_USER_DATA_PATH));
}

function devUrl() {
  return process.env.CREATE_CANVAS_DEV_URL?.trim() || "";
}

function webRoot() {
  const override = process.env.CREATE_CANVAS_WEB_DIST?.trim();
  if (override) return path.resolve(override);
  return app.isPackaged
    ? path.join(process.resourcesPath, "web-dist")
    : path.resolve(__dirname, "..", "..", "web", "dist");
}

async function serveAppAsset(request) {
  const root = webRoot();
  try {
    const filePath = resolveAppAssetPath(root, request.url);
    const data = await fsp.readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    return new Response(data, { status: 200, headers: { "Content-Type": contentType } });
  } catch (error) {
    console.error("[app-protocol] initial read failed", error);
    const fallback = path.join(root, "index.html");
    try {
      const data = await fsp.readFile(fallback);
      return new Response(data, { status: 200, headers: { "Content-Type": CONTENT_TYPES[".html"] } });
    } catch (fallbackError) {
      console.error("[app-protocol] fallback read failed", fallbackError);
      return new Response("Create build is missing", { status: 404 });
    }
  }
}

function settingsFilePath() {
  if (process.env.CREATE_CANVAS_SETTINGS_PATH) return path.resolve(process.env.CREATE_CANVAS_SETTINGS_PATH);
  return path.join(app.getPath("userData"), "settings.json");
}

function defaultSettings() {
  return createDefaultSettings({ picturesPath: app.getPath("pictures"), downloadsPath: app.getPath("downloads") });
}

function loadSettings() {
  const defaults = defaultSettings();
  try {
    const file = settingsFilePath();
    if (!fs.existsSync(file)) return defaults;
    return mergeSettings(defaults, JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    console.error("Failed to load local save settings:", error);
    return defaults;
  }
}

function persistSettings(candidate) {
  const validated = validateSettings(candidate);
  const file = settingsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
  settings = validated;
  return settings;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function fallbackFilename(kind, mimeType) {
  if (kind === "image") {
    if (mimeType === "image/jpeg") return "image.jpg";
    if (mimeType === "image/webp") return "image.webp";
    return "image.png";
  }
  if (kind === "video") return mimeType === "video/webm" ? "video.webm" : "video.mp4";
  if (kind === "canvas") return mimeType.startsWith("video/") ? "canvas.mp4" : mimeType.startsWith("audio/") ? "canvas.mp3" : "canvas.png";
  return "download.bin";
}

function generatedFileExtensions(kind) {
  if (kind === "image") return new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  if (kind === "video") return new Set([".mp4", ".webm", ".mov", ".m4v"]);
  if (kind === "canvas") return new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".m4a", ".ogg"]);
  return new Set([".bin", ".zip"]);
}

function mimeTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".png") return "image/png";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".m4v") return "video/x-m4v";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".ogg") return "audio/ogg";
  return "application/octet-stream";
}

function resolveGeneratedFilePath(kind, requestedPath, canvasFolder) {
  const directory = path.resolve(saveDirectoryForKind(settings, kind, canvasFolder));
  const candidate = path.resolve(String(requestedPath || ""));
  if (candidate !== directory && !candidate.startsWith(`${directory}${path.sep}`)) {
    throw new Error("Generated file path is outside the configured directory");
  }
  return candidate;
}

async function findGeneratedFile(kind, payload) {
  const directory = path.resolve(saveDirectoryForKind(settings, kind, payload.canvasFolder));
  ensureDirectory(directory);
  const extensions = generatedFileExtensions(kind);
  const requestedPath = String(payload.path || "").trim();
  if (requestedPath) {
    try {
      const candidate = resolveGeneratedFilePath(kind, requestedPath, payload.canvasFolder);
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // The settings directory may have changed since this record was written.
      // Fall through to filename and size matching inside the current directory.
    }
  }
  const requestedFilename = String(payload.filename || "").trim();
  if (requestedFilename && path.basename(requestedFilename) === requestedFilename) {
    const namedCandidate = path.join(directory, requestedFilename);
    try {
      const stat = await fsp.stat(namedCandidate);
      if (stat.isFile()) return namedCandidate;
    } catch {
      // Continue with metadata matching when the exact filename is unavailable.
    }
  }
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stat = await fsp.stat(filePath);
        return { filePath, size: stat.size, modifiedAt: stat.mtimeMs };
      }),
  );
  const expectedSize = Number(payload.size || 0);
  if (expectedSize > 0) {
    const exact = files.filter((file) => file.size === expectedSize).sort((left, right) => right.modifiedAt - left.modifiedAt);
    if (exact[0]) return exact[0].filePath;
    const close = files
      .map((file) => ({ ...file, sizeDifference: Math.abs(file.size - expectedSize) }))
      .filter((file) => file.sizeDifference / expectedSize <= 0.1)
      .sort((left, right) => left.sizeDifference - right.sizeDifference || right.modifiedAt - left.modifiedAt);
    if (close[0]) return close[0].filePath;
  }
  return files.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.filePath || null;
}

async function deleteGeneratedFile(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Generated file payload is required");
  const requestedPath = String(payload.path || "").trim();
  if (!requestedPath) throw new Error("Generated file path is required");
  const kind = normalizeSaveKind(payload.kind);
  const filePath = resolveGeneratedFilePath(kind, requestedPath, payload.canvasFolder);
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return { deleted: false, savePath: filePath };
    await fsp.unlink(filePath);
    return { deleted: true, savePath: filePath };
  } catch (error) {
    if (error && error.code === "ENOENT") return { deleted: false, savePath: filePath };
    throw error;
  }
}

async function readGeneratedFile(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Generated file payload is required");
  const kind = normalizeSaveKind(payload.kind);
  const filePath = await findGeneratedFile(kind, payload);
  if (!filePath) return null;
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) return null;
  if (stat.size > 512 * 1024 * 1024) throw new Error("Generated file is too large to restore");
  const data = await fsp.readFile(filePath);
  return {
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    savePath: filePath,
    mimeType: mimeTypeForPath(filePath),
    size: stat.size,
  };
}
function configureDownloadRouting(desktopSession) {
  desktopSession.on("will-download", (_event, item, webContents) => {
    try {
      if (!isTrustedRuntimeUrl(webContents.getURL(), devUrl())) {
        item.cancel();
        return;
      }
      const mimeType = String(item.getMimeType() || "").toLowerCase();
      const filename = item.getFilename() || fallbackFilename(classifyDownload("", mimeType), mimeType);
      const kind = classifyDownload(filename, mimeType);
      const directory = rootDirectoryForKind(settings, kind);
      ensureDirectory(directory);
      const savePath = buildSavePath({ directory, filename, exists: (candidate) => fs.existsSync(candidate) });
      item.setSavePath(savePath);
      item.once("done", (_doneEvent, state) => {
        if (state !== "completed") return;
        mainWindow?.webContents.send("desktop:download-complete", { kind, savePath });
        if (settings.openFolderAfterSave) shell.showItemInFolder(savePath);
      });
    } catch (error) {
      console.error("Failed to route download:", error);
      item.cancel();
    }
  });
}

function assertTrustedSender(event) {
  const url = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRuntimeUrl(url, devUrl())) throw new Error("Untrusted desktop IPC sender");
}

function buildApplicationMenu() {
  const template = [
    {
      label: "Create",
      submenu: [
        { label: "本地保存设置…", accelerator: "CmdOrCtrl+,", click: () => void openSaveSettings() },
        { type: "separator" },
        { label: "打开图片目录", click: () => void openSaveFolder("image") },
        { label: "打开视频目录", click: () => void openSaveFolder("video") },
        { label: "打开其他文件目录", click: () => void openSaveFolder("other") },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    {
      label: "查看",
      submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openSaveFolder(kind) {
  const directory = rootDirectoryForKind(settings, normalizeSaveKind(kind));
  ensureDirectory(directory);
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
}

async function openSaveSettings() {
  mainWindow?.webContents.send("desktop:open-save-settings");
}

async function chooseSaveDirectory(kind) {
  const normalized = normalizeSaveKind(kind);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: normalized === "image" ? "选择图片保存目录" : normalized === "video" ? "选择视频保存目录" : normalized === "canvas" ? "选择画布保存目录" : "选择其他文件目录",
    defaultPath: rootDirectoryForKind(settings, normalized),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "Create",
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#0c0f14",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: secureWindowOptions(path.join(__dirname, "preload.js")),
  });
  mainWindow.once("ready-to-show", () => { if (!smokeMode) mainWindow?.show(); });
  mainWindow.on("closed", () => { mainWindow = null; });

  const currentDevUrl = devUrl();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedRuntimeUrl(url, currentDevUrl)) return { action: "allow" };
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRuntimeUrl(url, currentDevUrl)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
  await mainWindow.loadURL(currentDevUrl || `${APP_ORIGIN}/`);
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:get-runtime", (event) => {
    assertTrustedSender(event);
    return { isDesktop: true, platform: process.platform, version: app.getVersion(), packaged: app.isPackaged };
  });
  ipcMain.handle("desktop:check-updates", async (event, metadataUrl) => {
    assertTrustedSender(event);
    if (!desktopUpdater) throw new Error("Update service is not ready");
    return desktopUpdater.checkForUpdates(String(metadataUrl || ""));
  });
  ipcMain.handle("desktop:download-update", async (event) => {
    assertTrustedSender(event);
    if (!desktopUpdater) throw new Error("Update service is not ready");
    return desktopUpdater.downloadUpdate();
  });
  ipcMain.handle("desktop:install-update", (event) => {
    assertTrustedSender(event);
    if (!desktopUpdater) throw new Error("Update service is not ready");
    return desktopUpdater.installUpdate();
  });
  ipcMain.handle("desktop:get-update-state", (event) => {
    assertTrustedSender(event);
    return desktopUpdater?.getState() || null;
  });
  ipcMain.handle("desktop:open-external", async (event, url) => {
    assertTrustedSender(event);
    if (!isAllowedExternalUrl(url)) throw new Error("URL is not allowed");
    await shell.openExternal(url);
  });
  ipcMain.handle("desktop:get-save-settings", (event) => {
    assertTrustedSender(event);
    return { ...settings };
  });
  ipcMain.handle("desktop:save-save-settings", (event, candidate) => {
    assertTrustedSender(event);
    return { ...persistSettings(candidate) };
  });
  ipcMain.handle("desktop:save-generated-file", async (event, payload) => {
    assertTrustedSender(event);
    if (!payload || typeof payload !== "object") throw new Error("Generated file payload is required");
    const kind = normalizeSaveKind(payload.kind);
    const mimeType = String(payload.mimeType || "").toLowerCase();
    const data = payload.data;
    const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
    if (!buffer?.length) throw new Error("Generated file data is empty");
    if (buffer.length > 512 * 1024 * 1024) throw new Error("Generated file is too large to save automatically");
    const directory = saveDirectoryForKind(settings, kind, payload.canvasFolder);
    ensureDirectory(directory);
    const requestedName = String(payload.filename || "").trim() || fallbackFilename(kind, mimeType);
    const savePath = buildSavePath({ directory, filename: requestedName, exists: (candidate) => fs.existsSync(candidate) });
    await fsp.writeFile(savePath, buffer);
    mainWindow?.webContents.send("desktop:download-complete", { kind, savePath });
    if (settings.openFolderAfterSave) shell.showItemInFolder(savePath);
    return { savePath };
  });
  ipcMain.handle("desktop:read-generated-file", async (event, payload) => {
    assertTrustedSender(event);
    return readGeneratedFile(payload);
  });
  ipcMain.handle("desktop:delete-generated-file", async (event, payload) => {
    assertTrustedSender(event);
    return deleteGeneratedFile(payload);
  });
  ipcMain.handle("desktop:choose-save-directory", async (event, kind) => {
    assertTrustedSender(event);
    return chooseSaveDirectory(normalizeSaveKind(kind));
  });
  ipcMain.handle("desktop:open-save-folder", async (event, kind) => {
    assertTrustedSender(event);
    await openSaveFolder(normalizeSaveKind(kind));
  });
}

const hasLock = smokeMode || app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    settings = loadSettings();
    desktopUpdater = createDesktopUpdateService({
      app,
      autoUpdater,
      net,
      onStateChange: (state) => {
        mainWindow?.webContents.send("desktop:update-event", state);
        const notify = state.status === UPDATE_STATUS.AVAILABLE || state.status === UPDATE_STATUS.DOWNLOADED;
        const notifyKey = `${state.status}:${state.latestVersion}`;
        if (!notify || notifiedUpdateKeys.has(notifyKey) || mainWindow?.isFocused() || !Notification.isSupported()) return;
        notifiedUpdateKeys.add(notifyKey);
        const notification = new Notification({
          title: state.status === UPDATE_STATUS.DOWNLOADED ? "Create 更新已下载" : "Create 有新版本",
          body: state.status === UPDATE_STATUS.DOWNLOADED
            ? `v${state.latestVersion} 已下载，打开应用后可重启安装。`
            : `v${state.latestVersion} 可用，打开 Create 查看更新说明。`,
        });
        notification.on("click", () => {
          if (!mainWindow) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send("desktop:update-event", state);
        });
        notification.show();
      },
    });
    const desktopSession = session.fromPartition(PARTITION);
    desktopSession.protocol.handle("app", serveAppAsset);
    configureDownloadRouting(desktopSession);
    registerIpcHandlers();
    buildApplicationMenu();
    await createMainWindow();
  }).catch((error) => {
    console.error("Create startup failed", error);
    dialog.showErrorBox("Create 启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
