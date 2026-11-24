const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const mockUrl = process.env.CREATE_CANVAS_MOCK_URL || "http://127.0.0.1:9890";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");
const catalogPath = path.resolve(__dirname, "..", "..", "web", "src", "lib", "__tests__", "fixtures", "momoapi-video-31.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")).models;

const resolutionLabels = ["480P", "720P", "1080P", "4K"];

function resolutionLabel(value) {
  const token = String(value).toLowerCase().replace(/p$/, "");
  if (token === "768") return "720P";
  return /^[248]k$/.test(token) ? token.toUpperCase() : `${token}P`;
}

function allowedResolutionLabels(capability, mode) {
  const modeOptions = capability.mode_capabilities?.[mode]?.resolution_options;
  const values = Array.isArray(modeOptions) && modeOptions.length ? modeOptions : capability.resolutions;
  return new Set(values.map(resolutionLabel));
}

function expectedRoleLabels(capability) {
  const modes = capability.modes || [];
  const slots = capability.slots || {};
  const labels = [];
  if ((slots.reference_image || 0) > 0 && modes.includes("reference-images")) labels.push("参考图");
  if ((slots.first_frame || 0) > 0 && (modes.includes("image-to-video") || modes.includes("first-last-frame"))) labels.push("首帧");
  if ((slots.keyframes || 0) > 0 && modes.includes("keyframes")) labels.push("关键帧");
  if ((slots.reference_video || 0) > 0 && modes.includes("reference-video")) labels.push("参考视频");
  if ((slots.reference_video || 0) > 0 && modes.includes("video-edit")) labels.push("视频编辑");
  if ((slots.reference_video || 0) > 0 && modes.includes("video-extension")) labels.push("视频续写");
  if ((slots.reference_audio || 0) > 0 && (modes.includes("reference-images") || modes.includes("reference-video"))) labels.push("参考音频");
  return labels;
}

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
  return { settingsPath };
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
  await page.waitForFunction(() => location.pathname === "/image" || location.pathname === "/video", null, { timeout: 30000 });
}

async function openVideo(page) {
  if (new URL(page.url()).pathname !== "/video") await page.locator('a[href="/video"]').click();
  await page.waitForFunction(() => location.pathname === "/video" && document.body.innerText.includes("视频创作台"), null, { timeout: 20000 });
}

async function selectModel(page, modelName) {
  const combobox = page.getByRole("combobox", { name: "视频模型" });
  await combobox.click();
  await combobox.fill("");
  await combobox.pressSequentially(modelName, { delay: 2 });
  await page.waitForTimeout(100);
  await combobox.press("Enter");
  try {
    await page.waitForFunction((name) => {
      const input = document.querySelector('input[aria-label="视频模型"]');
      const root = input?.closest(".ant-select");
      return root?.textContent?.includes(name);
    }, modelName, { timeout: 10000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      text: document.querySelector('input[aria-label="视频模型"]')?.closest(".ant-select")?.textContent || "",
      values: Array.from(document.querySelectorAll('input[aria-label="视频模型"]')).map((input) => ({
        value: input.value,
        ariaLabel: input.getAttribute("aria-label"),
      })),
    }));
    throw new Error(`failed to select ${modelName}: ${JSON.stringify(state)}`);
  }
}

async function buttonLabels(page, headingText) {
  const heading = page.getByText(headingText, { exact: true });
  await heading.waitFor({ state: "visible", timeout: 10000 });
  return (await heading.locator("xpath=..").getByRole("button").allTextContents()).map((text) => text.trim()).filter(Boolean);
}

async function waitForRequestedModel(modelName, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${mockUrl}/__mock/last-video-request`);
    const payload = await response.json();
    if (payload?.data?.model === modelName) return payload.data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`request for ${modelName} was not captured`);
}

(async () => {
  if (catalog.length !== 31) throw new Error(`expected 31 capability entries, got ${catalog.length}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-video-31-capabilities-"));
  const { settingsPath } = makeSettings(root);
  const userData = path.join(root, "user-data");
  fs.mkdirSync(userData, { recursive: true });
  const app = await launch({ userData, settingsPath });
  try {
    const page = await app.firstWindow();
    await loginIfNeeded(page);
    await openVideo(page);
    const textarea = page.locator("textarea:visible").first();
    await textarea.waitFor({ state: "visible", timeout: 15000 });

    for (const [index, entry] of catalog.entries()) {
      const name = entry.model_name;
      const capability = entry.capabilities;
      console.log(`VIDEO_31_MODEL_BEGIN ${index + 1}/${catalog.length} ${name}`);
      await selectModel(page, name);

      const bodyText = await page.locator("body").innerText();
      if (bodyText.includes("生成模式")) throw new Error(`${name}: legacy mode buttons are still visible`);

      const actualResolutions = (await buttonLabels(page, "清晰度")).sort();
      const expectedResolutions = [...resolutionLabels].sort();
      if (JSON.stringify(actualResolutions) !== JSON.stringify(expectedResolutions)) {
        throw new Error(`${name}: resolution buttons must stay visible, expected=${expectedResolutions.join(",")} actual=${actualResolutions.join(",")}`);
      }
      for (const label of resolutionLabels) {
        const button = page.getByRole("button", { name: label, exact: true });
        const supported = allowedResolutionLabels(capability, "text-to-video").has(label);
        if ((await button.isDisabled()) === supported) {
          throw new Error(`${name}: resolution ${label} disabled state does not match upstream support`);
        }
        if (supported) {
          await button.click();
          await page.waitForFunction((resolutionLabel) => Array.from(document.querySelectorAll("button"))
            .filter((item) => item.offsetParent !== null && item.textContent?.trim() === resolutionLabel)
            .some((item) => item.getAttribute("aria-pressed") === "true"), label, { timeout: 5000 });
        }
      }

      const expectedRoles = expectedRoleLabels(capability);
      const addReference = page.getByRole("button", { name: "添加参考素材" }).first();
      if (expectedRoles.length === 0) {
        if (!(await addReference.isDisabled())) throw new Error(`${name}: add-reference should be disabled when no role is available`);
      } else {
        await addReference.click();
        await page.getByText("选择素材用途", { exact: false }).waitFor({ state: "visible", timeout: 5000 });
        for (const role of expectedRoles) {
          try {
            const button = page.getByRole("button", { name: role, exact: true });
            await button.waitFor({ state: "visible", timeout: 5000 });
            if (await button.isDisabled()) throw new Error(`role ${role} should be enabled`);
          } catch (error) {
            const body = await page.locator("body").innerText();
            throw new Error(`${name}: reference role ${role} invalid: ${error.message}; bodyTail=${body.slice(-1200)}`);
          }
        }
        const firstFrameRole = page.getByRole("button", { name: "首帧", exact: true });
        await firstFrameRole.waitFor({ state: "visible", timeout: 5000 });
        if ((await firstFrameRole.isDisabled()) === expectedRoles.includes("首帧")) throw new Error(`${name}: first-frame role availability is wrong`);
        const lastFrameRole = page.getByRole("button", { name: "尾帧", exact: true });
        await lastFrameRole.waitFor({ state: "visible", timeout: 5000 });
        if (!(await lastFrameRole.isDisabled())) throw new Error(`${name}: tail-frame role must stay disabled before a first frame exists`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
      }

      const audioSwitch = page.getByRole("switch", { name: "生成音频" });
      if ((await audioSwitch.isDisabled()) === Boolean(capability.supports_generate_audio)) {
        throw new Error(`${name}: generate-audio switch state does not match capabilities`);
      }

      if ((capability.parameters || []).length) {
        await page.getByText("模型参数", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
        for (const parameter of capability.parameters) {
          const label = parameter.label || parameter.key;
          if (!(await page.getByText(label, { exact: true }).count())) throw new Error(`${name}: missing parameter ${label}`);
        }
      }

      console.log(`VIDEO_31_MODEL_UI_OK ${index + 1}/${catalog.length} ${name}`);
      await textarea.fill(`mock capability ${name}`);
      await page.getByRole("button", { name: "开始生成", exact: true }).click();
      const request = await waitForRequestedModel(name);
      if (request.__mode !== "text-to-video") throw new Error(`${name}: request mode was ${request.__mode}`);
      if (!request.prompt.includes(name)) throw new Error(`${name}: request prompt mismatch`);
      if (!capability.resolutions.some((resolution) => String(request.resolution).toLowerCase() === String(resolution).toLowerCase())) {
        throw new Error(`${name}: request resolution ${request.resolution} is not declared`);
      }
      if (!capability.aspect_ratios.includes(request.aspect_ratio)) {
        throw new Error(`${name}: request ratio ${request.aspect_ratio} is not declared`);
      }
      console.log(`VIDEO_31_MODEL_REQUEST_OK ${index + 1}/${catalog.length} ${name}`);
    }

    console.log(`VIDEO_31_CAPABILITIES_APP_OK ${catalog.length}/${catalog.length}`);
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
