const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const mockUrl = process.env.CREATE_CANVAS_MOCK_URL || "http://127.0.0.1:9890";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");
const originalPrompt = "retry-original-prompt";
const changedPrompt = "retry-changed-current-prompt";
const originalModel = "gpt-image-2";
const changedModel = "gpt-image-2-alt";

async function selectModel(page, modelName) {
  const combobox = page.getByRole("combobox", { name: "生图模型" });
  await combobox.click();
  await combobox.fill("");
  await combobox.pressSequentially(modelName, { delay: 2 });
  await page.waitForTimeout(100);
  await combobox.press("Enter");
  await page.waitForFunction((name) => {
    const input = document.querySelector('input[aria-label="生图模型"]');
    return input?.closest(".ant-select")?.textContent?.includes(name);
  }, modelName, { timeout: 10000 });
}

async function waitForImageRequest(prompt, model, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${mockUrl}/__mock/last-image-request`);
    const payload = await response.json();
    const request = payload?.data;
    if (request?.prompt === prompt && request?.model === model) return request;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`did not observe retry request prompt=${prompt} model=${model}`);
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-image-retry-"));
  await fetch(`${mockUrl}/__mock/reset-image-state`, { method: "POST" });
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

    await selectModel(page, originalModel);
    await page.locator("textarea").first().fill(originalPrompt);
    await fetch(`${mockUrl}/__mock/fail-next-image`, { method: "POST" });
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await page.getByText("生成失败", { exact: true }).waitFor({ timeout: 20000 });
    const firstRequest = await waitForImageRequest(originalPrompt, originalModel);
    if (firstRequest.prompt !== originalPrompt || firstRequest.model !== originalModel) {
      throw new Error(`unexpected initial request: ${JSON.stringify(firstRequest)}`);
    }

    await page.locator("textarea").first().fill(changedPrompt);
    await selectModel(page, changedModel);
    await page.getByRole("button", { name: /重\s*试/ }).click();

    const retryRequest = await waitForImageRequest(originalPrompt, originalModel);
    if (retryRequest.prompt !== originalPrompt || retryRequest.model !== originalModel) {
      throw new Error(`retry did not preserve the failed snapshot: ${JSON.stringify(retryRequest)}`);
    }
    await page.waitForFunction(() => !document.body.innerText.includes("生成失败"), null, { timeout: 20000 });
    console.log("MOCK_IMAGE_RETRY_SNAPSHOT_OK", JSON.stringify({ prompt: retryRequest.prompt, model: retryRequest.model }));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});