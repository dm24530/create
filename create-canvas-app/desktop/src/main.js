const { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  APP_ORIGIN,
  PARTITION,
  isAllowedExternalUrl,
  isTrustedAppUrl,
  isTrustedRuntimeUrl,
  resolveAppAssetPath,
  secureWindowOptions,
} = require("./security");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
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
const smokeMode = process.env.CREATE_CANVAS_SMOKE === "1";

if (process.env.CREATE_CANVAS_USER_DATA_PATH) {
  app.setPath("userData", path.resolve(process.env.CREATE_CANVAS_USER_DATA_PATH));
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
    const data = await fs.readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    return new Response(data, { status: 200, headers: { "Content-Type": contentType } });
  } catch (error) {
    console.error("[app-protocol] initial read failed", error);
    const fallback = path.join(root, "index.html");
    try {
      const data = await fs.readFile(fallback);
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": CONTENT_TYPES[".html"] },
      });
    } catch (fallbackError) {
      console.error("[app-protocol] fallback read failed", fallbackError);
      return new Response("Create Canvas build is missing", { status: 404 });
    }
  }
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

  mainWindow.once("ready-to-show", () => {
    if (!smokeMode) mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const devUrl = process.env.CREATE_CANVAS_DEV_URL?.trim();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedRuntimeUrl(url, devUrl)) return { action: "allow" };
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRuntimeUrl(url, devUrl)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
  await mainWindow.loadURL(devUrl || `${APP_ORIGIN}/`);
}

const hasLock = smokeMode || app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const desktopSession = session.fromPartition(PARTITION);
    desktopSession.protocol.handle("app", serveAppAsset);
    ipcMain.handle("desktop:get-runtime", () => ({
      isDesktop: true,
      platform: process.platform,
      version: app.getVersion(),
      packaged: app.isPackaged,
    }));
    ipcMain.handle("desktop:open-external", async (_event, url) => {
      if (!isAllowedExternalUrl(url)) throw new Error("URL is not allowed");
      await shell.openExternal(url);
    });
    await createMainWindow();
  }).catch((error) => {
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






