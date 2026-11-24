const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-navigation-smoke-"));
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, ".."),
    executablePath: require("electron"),
    env: { ...process.env, CREATE_CANVAS_SMOKE: "1", CREATE_CANVAS_DEV_URL: devUrl, CREATE_CANVAS_USER_DATA_PATH: userData },
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

    await page.locator('a[href="/assets"]').first().click();
    await page.waitForFunction(() => location.pathname === "/assets" && document.body.innerText.includes("我的资产"), null, { timeout: 15000 });
    await page.goto(`${devUrl}/prompts`);
    await page.waitForFunction(() => location.pathname === "/prompts" && document.body.innerText.includes("提示词中心"), null, { timeout: 15000 });
    console.log("MOCK_NAVIGATION_AND_EMPTY_STATES_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});