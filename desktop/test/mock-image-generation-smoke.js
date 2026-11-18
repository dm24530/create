const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");
const promptText = "mockpersist";

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

async function waitForGeneratedFile(dir, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(dir).filter((name) => /\.(png|jpe?g|webp)$/i.test(name));
    if (files.length) return path.join(dir, files.sort().at(-1));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for generated image in ${dir}`);
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
  await page.waitForFunction(() => location.pathname === "/image" && document.body.innerText.includes("生图工作台"), null, { timeout: 30000 });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-image-generation-"));
  const { settings, settingsPath } = makeSettings(root);
  const userData = path.join(root, "user-data");
  fs.mkdirSync(userData, { recursive: true });
  let app = await launch({ userData, settingsPath });
  try {
    const page = await app.firstWindow();
    await loginIfNeeded(page);
    await page.locator("textarea").first().fill(promptText);
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const savedPath = await waitForGeneratedFile(settings.imageDir);
    const bytes = fs.readFileSync(savedPath);
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("saved image is not a PNG");
    console.log("IMAGE_SAVED", savedPath, bytes.length);
  } finally {
    await app.close();
  }

  app = await launch({ userData, settingsPath });
  try {
    const page = await app.firstWindow();
    await loginIfNeeded(page);
    await page.getByRole("button", { name: "生成记录", exact: true }).click();
    await page.waitForFunction((prompt) => document.body.innerText.includes(prompt), promptText, { timeout: 15000 });
    console.log("MOCK_IMAGE_GENERATION_PERSISTENCE_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
