const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");
const promptText = "mockcanvas";

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
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function waitForCanvasImage(canvasDir, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = walkFiles(canvasDir).filter((file) => /\.(png|jpe?g|webp)$/i.test(file));
    if (files.length) return files.sort().at(-1);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for canvas image in ${canvasDir}`);
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
  await page.waitForTimeout(1000);
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-canvas-generation-"));
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
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: "visible", timeout: 15000 });
    await editor.fill(promptText);
    await page.getByRole("button", { name: "生成", exact: true }).click();
    const savedPath = await waitForCanvasImage(settings.canvasDir);
    const stat = fs.statSync(savedPath);
    if (!stat.isFile() || stat.size < 8) throw new Error("canvas generated image was not saved");
    console.log("CANVAS_IMAGE_SAVED", savedPath, stat.size, "project", projectId);
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
    await page.waitForFunction((prompt) => document.body.innerText.includes(prompt) || document.body.innerText.includes("图片"), promptText, { timeout: 15000 });
    console.log("MOCK_CANVAS_GENERATION_PERSISTENCE_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
