const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3010";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");

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

async function waitForGeneratedFiles(dir, count, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(dir).filter((name) => /\.(mp4|webm|mov)$/i.test(name));
    if (files.length >= count) return files;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${count} generated videos in ${dir}`);
}


(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-video-concurrency-"));
  const { settings, settingsPath } = makeSettings(root);
  const userData = path.join(root, "user-data");
  fs.mkdirSync(userData, { recursive: true });
  const app = await electron.launch({
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
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    if (await page.locator('input[type="password"]').count()) {
      await page.locator("input[type=text]").click();
      await page.keyboard.type("mock@example.com");
      await page.locator("input[type=password]").click();
      await page.keyboard.type("test");
      await page.locator("button[type=submit]").click();
    }
    await page.waitForFunction(() => location.pathname === "/image" || location.pathname === "/video", null, { timeout: 30000 });
    await page.locator('a[href="/video"]').click();
    await page.waitForFunction(() => document.body.innerText.includes("视频创作台"), null, { timeout: 15000 });
    const textarea = page.locator("textarea:visible").first();
    const generate = page.getByRole("button", { name: "开始生成", exact: true });
    await textarea.fill("并发任务一");
    await generate.click();
    await textarea.fill("并发任务二");
    await generate.click();
    if (await generate.isDisabled()) throw new Error("generate button stayed locked after the first task started");
    await page.locator('a[href="/image"]').click();
    await page.waitForTimeout(1500);
    await page.locator('a[href="/video"]').click();
    await page.waitForFunction(() => document.body.innerText.includes("视频创作台"), null, { timeout: 15000 });
    const files = await waitForGeneratedFiles(settings.videoDir, 2);
    if (!files.every((name) => fs.statSync(path.join(settings.videoDir, name)).size > 1)) throw new Error("one of the generated videos is empty");
    const videoCount = await page.locator("video").count();
    if (videoCount < 2) throw new Error(`expected 2 completed video cards, got ${videoCount}`);
    console.log("VIDEO_CONCURRENCY_AND_PAGE_SWITCH_OK", files.length);
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
