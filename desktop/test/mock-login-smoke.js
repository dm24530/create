const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");
const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-canvas-smoke-"));
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, ".."),
    executablePath: require("electron"),
    env: {
      ...process.env,
      CREATE_CANVAS_SMOKE: "1",
      CREATE_CANVAS_DEV_URL: devUrl,
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
    await page.locator('a[href="/canvas"]').first().click();
    await page.waitForFunction(() => document.body.innerText.includes("新建画布"), null, { timeout: 30000 });
    await page.getByRole("button", { name: "新建画布" }).first().dispatchEvent("click");
    await page.waitForURL(/\/canvas\/[^/]+/, { timeout: 30000 });
    console.log("MOCK_LOGIN_CANVAS_CREATED_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
