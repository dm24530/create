const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3010";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");
const imagePrompt = "mock canvas image";
const videoPrompt = "mock canvas video";

function makeSettings(root) {
  const settings = {
    settingsVersion: 4,
    imageDir: path.join(root, "images"),
    videoDir: path.join(root, "videos"),
    canvasDir: path.join(root, "canvas"),
    otherDir: path.join(root, "other"),
    openFolderAfterSave: false,
  };
  for (const dir of [settings.imageDir, settings.videoDir, settings.canvasDir, settings.otherDir]) fs.mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(root, "settings.json");
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return { settings, settingsPath };
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : entry.isFile() ? [full] : [];
  });
}

async function waitForFile(dir, pattern, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const file = walkFiles(dir).find((item) => pattern.test(item));
    if (file) return file;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${pattern} under ${dir}`);
}

async function launch({ userData, settingsPath }) {
  return electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, ".."),
    executablePath: require("electron"),
    env: {
      ...process.env,
      CREATE_CANVAS_SMOKE: "1",
      CREATE_CANVAS_DEV_URL: devUrl,
      CREATE_CANVAS_WEB_DIST: webDist,
      CREATE_CANVAS_USER_DATA_PATH: userData,
      CREATE_CANVAS_SETTINGS_PATH: settingsPath,
    },
  });
}

async function loginIfNeeded(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
  if (await page.locator('input[type="password"]').count()) {
    await page.locator("input[type=text]").click();
    await page.keyboard.type("mock@example.com");
    await page.locator("input[type=password]").click();
    await page.keyboard.type("test");
    await page.locator("button[type=submit]").click();
  }
  await page.waitForFunction(() => location.pathname === "/image" || location.pathname.startsWith("/canvas"), null, { timeout: 30000 });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-canvas-image-video-"));
  const { settings, settingsPath } = makeSettings(root);
  const userData = path.join(root, "user-data");
  fs.mkdirSync(userData, { recursive: true });
  let app = await launch({ userData, settingsPath });
  let projectId = "";
  try {
    const page = await app.firstWindow();
    await loginIfNeeded(page);
    await page.locator('a[href="/canvas"]').click();
    await page.getByRole("button", { name: "新建画布" }).first().click();
    await page.waitForURL(/\/canvas\/[^/]+/, { timeout: 15000 });
    projectId = new URL(page.url()).pathname.split("/").pop();

    await page.getByRole("button", { name: "图片", exact: true }).click();
    const imageEditor = page.locator('[contenteditable="true"]').last();
    await imageEditor.waitFor({ state: "visible", timeout: 15000 });
    await imageEditor.fill(imagePrompt);
    await page.getByRole("button", { name: "生成", exact: true }).last().click();
    const imageFile = await waitForFile(settings.canvasDir, /\.(png|jpe?g|webp)$/i);
    if (fs.statSync(imageFile).size < 8) throw new Error("canvas image is empty");

    await page.getByRole("button", { name: "视频", exact: true }).click();
    await page.waitForTimeout(1200);
    const videoEditor = page.locator('[contenteditable="true"]').last();
    await videoEditor.waitFor({ state: "visible", timeout: 15000 });    await videoEditor.fill(videoPrompt);
    await page.getByRole("button", { name: "生成", exact: true }).last().click();
    const videoFile = await waitForFile(settings.canvasDir, /\.(mp4|webm|mov)$/i);
    if (fs.statSync(videoFile).size < 8) throw new Error("canvas video is empty");

    console.log("CANVAS_IMAGE_VIDEO_OK", { projectId, imageFile, videoFile });
  } finally {
    await app.close();
  }

  app = await launch({ userData, settingsPath });
  try {
    const page = await app.firstWindow();
    await loginIfNeeded(page);
    if (new URL(page.url()).pathname !== "/canvas") await page.locator('a[href="/canvas"]').click();
    await page.getByText("Create 1", { exact: true }).first().click();
    await page.waitForURL(new RegExp(`/canvas/${projectId}$`), { timeout: 15000 });
    await page.waitForFunction((prompt) => document.body.innerText.includes(prompt) || document.body.innerText.includes("图片"), imagePrompt, { timeout: 15000 });
    console.log("CANVAS_IMAGE_VIDEO_PERSISTENCE_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
