const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");

async function selectApiKey(page, label) {
  const select = page.locator('select[aria-label="API Key"]:visible, select[aria-label="视频 API Key"]:visible').first();
  await select.selectOption({ label });
  await page.waitForTimeout(700);
}

async function openModelOptions(page, label) {
  const combobox = page.getByRole("combobox", { name: label });
  await combobox.click();
  await page.waitForTimeout(250);
  const options = await page.locator('.ant-select-dropdown:visible .ant-select-item-option').allTextContents();
  await page.keyboard.press("Escape");
  return options.map((item) => item.trim()).filter(Boolean);
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-model-boundary-"));
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
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("create-login-form").waitFor({ timeout: 15000 });
    await page.locator("input[type=text]").click();
    await page.keyboard.type("mock@example.com");
    await page.locator("input[type=password]").click();
    await page.keyboard.type("test");
    await page.locator("button[type=submit]").click();
    await page.getByTestId("image-workbench").waitFor({ timeout: 30000 });

    await selectApiKey(page, "Mock Video Key");
    const imageBoundaryOptions = await openModelOptions(page, "生图模型");
    if (imageBoundaryOptions.length) throw new Error(`image workbench exposed models for a video-only key: ${imageBoundaryOptions.join(",")}`);
    await page.locator("textarea").first().fill("boundary check");
    if (!(await page.getByRole("button", { name: "开始生成", exact: true }).isDisabled())) {
      throw new Error("image generate button must be disabled when the selected key has no image model");
    }

    await selectApiKey(page, "Mock Creation");
    const imageOptions = await openModelOptions(page, "生图模型");
    if (!imageOptions.some((item) => item.includes("gpt-image-2"))) throw new Error(`image models missing after switching back: ${imageOptions.join(",")}`);
    if (imageOptions.some((item) => /grok-imagine-video|seedance|muse-video/.test(item))) throw new Error(`video model leaked into image workbench: ${imageOptions.join(",")}`);

    if (new URL(page.url()).pathname !== "/video") await page.locator('a[href="/video"]').click();
    await page.waitForFunction(() => location.pathname === "/video" && document.body.innerText.includes("视频创作台"), null, { timeout: 20000 });
    await selectApiKey(page, "Mock Image Key");
    const videoBoundaryOptions = await openModelOptions(page, "视频模型");
    if (videoBoundaryOptions.length) throw new Error(`video workbench exposed models for an image-only key: ${videoBoundaryOptions.join(",")}`);
    await page.locator("textarea:visible").first().fill("boundary check");
    if (!(await page.getByRole("button", { name: "开始生成", exact: true }).isDisabled())) {
      throw new Error("video generate button must be disabled when the selected key has no video model");
    }

    await selectApiKey(page, "Mock Creation");
    const videoOptions = await openModelOptions(page, "视频模型");
    if (!videoOptions.some((item) => item.includes("grok-imagine-video"))) throw new Error(`video models missing after switching back: ${videoOptions.join(",")}`);
    if (videoOptions.some((item) => /gpt-image-2|gpt-5\.5/.test(item))) throw new Error(`image/text model leaked into video workbench: ${videoOptions.join(",")}`);

    console.log("MOCK_WORKBENCH_MODEL_BOUNDARY_OK", JSON.stringify({ imageOptions, videoOptions }));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});