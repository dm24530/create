const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require("electron");
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
      return new Response("Create Canvas build is missing", { status: 404 });
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

function saveDirectoryForKind(kind) {
  if (kind === "image") return settings.imageDir;
  if (kind === "video") return settings.videoDir;
  return settings.otherDir;
}

function fallbackFilename(kind, mimeType) {
  if (kind === "image") {
    if (mimeType === "image/jpeg") return "image.jpg";
    if (mimeType === "image/webp") return "image.webp";
    return "image.png";
  }
  if (kind === "video") return mimeType === "video/webm" ? "video.webm" : "video.mp4";
  return "download.bin";
}

function generatedFileExtensions(kind) {
  if (kind === "image") return new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  if (kind === "video") return new Set([".mp4", ".webm", ".mov", ".m4v"]);
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
  return "application/octet-stream";
}

function resolveGeneratedFilePath(kind, requestedPath) {
  const directory = path.resolve(saveDirectoryForKind(kind));
  const candidate = path.resolve(String(requestedPath || ""));
  if (candidate !== directory && !candidate.startsWith(`${directory}${path.sep}`)) {
    throw new Error("Generated file path is outside the configured directory");
  }
  return candidate;
}

async function findGeneratedFile(kind, payload) {
  const directory = path.resolve(saveDirectoryForKind(kind));
  ensureDirectory(directory);
  const extensions = generatedFileExtensions(kind);
  const requestedPath = String(payload.path || "").trim();
  if (requestedPath) {
    const candidate = resolveGeneratedFilePath(kind, requestedPath);
    if (fs.existsSync(candidate)) return candidate;
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

async function readGeneratedFile(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Generated file payload is required");
  const kind = payload.kind === "image" || payload.kind === "video" ? payload.kind : "other";
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
      const directory = saveDirectoryForKind(kind);
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
      label: "Create Canvas",
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
  const directory = saveDirectoryForKind(kind === "image" || kind === "video" ? kind : "other");
  ensureDirectory(directory);
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
}

async function openSaveSettings() {
  mainWindow?.webContents.send("desktop:open-save-settings");
}

async function chooseSaveDirectory(kind) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === "image" ? "选择图片保存目录" : kind === "video" ? "选择视频保存目录" : "选择其他文件目录",
    defaultPath: saveDirectoryForKind(kind),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "Create Canvas",
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#0c0f14",
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
    const kind = payload.kind === "image" || payload.kind === "video" ? payload.kind : "other";
    const mimeType = String(payload.mimeType || "").toLowerCase();
    const data = payload.data;
    const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
    if (!buffer?.length) throw new Error("Generated file data is empty");
    if (buffer.length > 512 * 1024 * 1024) throw new Error("Generated file is too large to save automatically");
    const directory = saveDirectoryForKind(kind);
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
  });  ipcMain.handle("desktop:choose-save-directory", async (event, kind) => {
    assertTrustedSender(event);
    const normalized = kind === "image" || kind === "video" ? kind : "other";
    return chooseSaveDirectory(normalized);
  });
  ipcMain.handle("desktop:open-save-folder", async (event, kind) => {
    assertTrustedSender(event);
    await openSaveFolder(kind === "image" || kind === "video" ? kind : "other");
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
    const desktopSession = session.fromPartition(PARTITION);
    desktopSession.protocol.handle("app", serveAppAsset);
    configureDownloadRouting(desktopSession);
    registerIpcHandlers();
    buildApplicationMenu();
    await createMainWindow();
  }).catch((error) => {
    console.error("Create Canvas startup failed", error);
    dialog.showErrorBox("Create Canvas 启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
