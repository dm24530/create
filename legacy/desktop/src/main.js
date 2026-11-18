const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { isTrustedAppUrl, resolveWebUrl } = require("./app-config");
const { buildSavePath, classifyDownload } = require("./download-policy");
const {
  createDefaultSettings,
  mergeSettings,
  validateSettings,
} = require("./settings-store");

const PARTITION = "persist:create-desktop";
const APP_TITLE = "Create";
const SETTINGS_FILE_NAME = "settings.json";
const appWebUrl = resolveWebUrl({ isPackaged: app.isPackaged, env: process.env });
const settingsPagePath = path.join(__dirname, "..", "settings", "index.html");
const settingsPageUrl = pathToFileURL(settingsPagePath).href;

let mainWindow = null;
let settingsWindow = null;
let settings = null;
let manualUpdateCheck = false;
let updateCheckRunning = false;
let updateTimer = null;

if (process.env.CREATE_DESKTOP_USER_DATA_PATH) {
  const userDataPath = path.resolve(process.env.CREATE_DESKTOP_USER_DATA_PATH);
  fs.mkdirSync(userDataPath, { recursive: true });
  app.setPath("userData", userDataPath);
}

function settingsFilePath() {
  if (process.env.CREATE_DESKTOP_SETTINGS_PATH) {
    return path.resolve(process.env.CREATE_DESKTOP_SETTINGS_PATH);
  }
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function defaultSettings() {
  return createDefaultSettings({
    picturesPath: app.getPath("pictures"),
    downloadsPath: app.getPath("downloads"),
    env: process.env,
  });
}

function loadSettings() {
  const defaults = defaultSettings();
  const file = settingsFilePath();
  try {
    if (!fs.existsSync(file)) return defaults;
    return mergeSettings(defaults, JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    console.error("Failed to load settings; using defaults:", error);
    return defaults;
  }
}

function persistSettings(nextSettings) {
  const validated = validateSettings(nextSettings);
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
  if (kind === "video") {
    if (mimeType === "video/webm") return "video.webm";
    return "video.mp4";
  }
  return "download.bin";
}

function configureDownloadRouting(desktopSession) {
  desktopSession.on("will-download", (_event, item, webContents) => {
    try {
      if (!isTrustedAppUrl(webContents.getURL(), appWebUrl)) {
        item.cancel();
        return;
      }
      const mimeType = String(item.getMimeType() || "").toLowerCase();
      const filename = item.getFilename() || fallbackFilename(classifyDownload("", mimeType), mimeType);
      const kind = classifyDownload(filename, mimeType);
      const directory = saveDirectoryForKind(kind);
      ensureDirectory(directory);
      const savePath = buildSavePath({
        directory,
        filename,
        exists: (candidate) => fs.existsSync(candidate),
      });
      item.setSavePath(savePath);
      item.once("done", (_doneEvent, state) => {
        if (state !== "completed") return;
        mainWindow?.webContents.send("desktop:download-complete", {
          kind,
          filename: path.basename(savePath),
          savePath,
        });
        if (settings.openFolderAfterSave) shell.showItemInFolder(savePath);
      });
    } catch (error) {
      console.error("Failed to route download:", error);
      item.cancel();
    }
  });
}

function secureWindowOptions(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    partition: PARTITION,
  };
}

function sameOrigin(left, right) {
  return isTrustedAppUrl(left, right);
}

function configureWebContentsSecurity(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/i.test(url)) {
      if (/^(mailto|tel):/i.test(url)) void shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    }
    if (mainWindow && sameOrigin(url, appWebUrl)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 780,
          webPreferences: secureWindowOptions(path.join(__dirname, "preload.js")),
        },
      };
    }
    void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (sameOrigin(url, appWebUrl)) return;
    event.preventDefault();
    if (/^https?:/i.test(url) || /^(mailto|tel):/i.test(url)) {
      void shell.openExternal(url).catch(() => undefined);
    }
  });
}

async function createMainWindow() {
  const desktopSession = session.fromPartition(PARTITION);
  configureDownloadRouting(desktopSession);
  desktopSession.setPermissionRequestHandler((contents, permission, callback) => {
    if (!isTrustedAppUrl(contents.getURL(), appWebUrl)) {
      callback(false);
      return;
    }
    const allowed = new Set([
      "clipboard-read",
      "clipboard-sanitized-write",
      "fullscreen",
      "media",
      "notifications",
    ]);
    callback(allowed.has(permission));
  });

  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#0c0f14",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: secureWindowOptions(path.join(__dirname, "preload.js")),
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (!mainWindow || errorCode === -3) return;
    const retryUrl = JSON.stringify(appWebUrl);
    const description = JSON.stringify(`${errorDescription} (${errorCode})`);
    const errorHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Create</title><style>
      body{margin:0;background:#0c0f14;color:#f5f5f4;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
      main{max-width:620px;padding:32px;text-align:center} h1{font-size:22px} p{color:#a8a29e;line-height:1.7}
      button{margin-top:18px;border:0;border-radius:8px;padding:10px 18px;background:#f97316;color:#111827;font-weight:700;cursor:pointer}
    </style></head><body><main><h1>Create 暂时无法连接</h1><p>请检查服务器地址或网络连接。</p>
      <p>${validatedURL || appWebUrl}<br>${errorDescription} (${errorCode})</p>
      <button onclick="location.href=${retryUrl}">重试</button></main></body></html>`;
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  });

  await mainWindow.loadURL(appWebUrl);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    title: "Create 本地保存设置",
    width: 760,
    height: 620,
    minWidth: 680,
    minHeight: 560,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    show: false,
    backgroundColor: "#f7f7f5",
    webPreferences: {
      preload: path.join(__dirname, "settings-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  void settingsWindow.loadFile(settingsPagePath);
}

function trustedSenderUrl(event) {
  try {
    return event.senderFrame?.url || event.sender.getURL();
  } catch {
    return "";
  }
}

function assertTrustedAppSender(event) {
  if (!isTrustedAppUrl(trustedSenderUrl(event), appWebUrl)) {
    throw new Error("untrusted desktop bridge sender");
  }
}

function assertTrustedSettingsSender(event) {
  const url = trustedSenderUrl(event);
  if (!url.startsWith(settingsPageUrl)) {
    throw new Error("untrusted settings bridge sender");
  }
}

function setupAutoUpdates() {
  if (!app.isPackaged || process.env.CREATE_DESKTOP_DISABLE_UPDATES === "1") return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (error) => {
    console.error("Auto update failed:", error);
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      void dialog.showMessageBox(mainWindow || undefined, {
        type: "error",
        title: "检查更新失败",
        message: "暂时无法检查 Create 更新，请稍后再试。",
      });
    }
  });
  autoUpdater.on("update-not-available", () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    void dialog.showMessageBox(mainWindow || undefined, {
      type: "info",
      title: "检查更新",
      message: "当前已经是最新版本。",
    });
  });
  autoUpdater.on("update-available", (info) => {
    console.log(`Create update available: ${info.version}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    console.log(`Create update download: ${progress.percent.toFixed(1)}%`);
  });
  autoUpdater.on("update-downloaded", async (info) => {
    manualUpdateCheck = false;
    const result = await dialog.showMessageBox(mainWindow || undefined, {
      type: "info",
      title: "Create 更新已下载",
      message: `新版本 ${info.version} 已下载完成。`,
      detail: "重启 Create 后安装更新。未完成的生成任务请先保存。",
      buttons: ["立即重启并安装", "稍后"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  setTimeout(() => void checkForUpdates(false), 10_000).unref();
  updateTimer = setInterval(() => void checkForUpdates(false), 4 * 60 * 60 * 1000);
  updateTimer.unref();
}

async function checkForUpdates(manual) {
  if (!app.isPackaged || process.env.CREATE_DESKTOP_DISABLE_UPDATES === "1") {
    if (manual) {
      await dialog.showMessageBox(mainWindow || undefined, {
        type: "info",
        title: "检查更新",
        message: "开发版本不检查更新。",
      });
    }
    return;
  }
  if (updateCheckRunning) return;
  updateCheckRunning = true;
  manualUpdateCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("Failed to check for updates:", error);
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      await dialog.showMessageBox(mainWindow || undefined, {
        type: "error",
        title: "检查更新失败",
        message: "暂时无法连接更新服务器，请稍后再试。",
      });
    }
  } finally {
    updateCheckRunning = false;
  }
}

function buildApplicationMenu() {
  const template = [
    {
      label: "Create",
      submenu: [
        {
          label: "本地保存设置…",
          accelerator: "CmdOrCtrl+,",
          click: () => createSettingsWindow(),
        },
        { type: "separator" },
        {
          label: "打开图片目录",
          click: () => {
            ensureDirectory(settings.imageDir);
            void shell.openPath(settings.imageDir);
          },
        },
        {
          label: "打开视频目录",
          click: () => {
            ensureDirectory(settings.videoDir);
            void shell.openPath(settings.videoDir);
          },
        },
        { type: "separator" },
        {
          label: "检查更新…",
          click: () => void checkForUpdates(true),
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "页面",
      submenu: [
        { role: "reload", label: "刷新" },
        { role: "forceReload", label: "强制刷新" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "查看",
      submenu: [
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools", label: "开发者工具" }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:get-runtime", (event) => {
    assertTrustedAppSender(event);
    return {
    isDesktop: true,
    platform: process.platform,
    version: app.getVersion(),
    packaged: app.isPackaged,
    };
  });

  ipcMain.handle("desktop:open-settings", (event) => {
    assertTrustedAppSender(event);
    createSettingsWindow();
  });

  ipcMain.handle("desktop:get-settings", (event) => {
    assertTrustedSettingsSender(event);
    return { ...settings };
  });

  ipcMain.handle("desktop:open-save-folder", async (event, kind) => {
    assertTrustedSettingsSender(event);
    const directory = saveDirectoryForKind(kind === "image" || kind === "video" ? kind : "other");
    ensureDirectory(directory);
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });

  ipcMain.handle("desktop-settings:choose-folder", async (event, kind) => {
    assertTrustedSettingsSender(event);
    const current = saveDirectoryForKind(kind);
    const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      title: kind === "image" ? "选择图片保存目录" : kind === "video" ? "选择视频保存目录" : "选择其他下载目录",
      defaultPath: current,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("desktop-settings:save", (event, candidate) => {
    assertTrustedSettingsSender(event);
    const saved = persistSettings(candidate);
    return { settings: { ...saved }, reloaded: false };
  });

  ipcMain.handle("desktop-settings:close", (event) => {
    assertTrustedSettingsSender(event);
    settingsWindow?.close();
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
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
    registerIpcHandlers();
    buildApplicationMenu();
    setupAutoUpdates();

    app.on("web-contents-created", (_event, contents) => {
      configureWebContentsSecurity(contents);
    });

    await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    });
  }).catch((error) => {
    console.error("Failed to start Create Desktop:", error);
    dialog.showErrorBox("Create Desktop 启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
