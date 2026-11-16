const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-canvas-account-smoke-"));
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, ".."),
    executablePath: require("electron"),
    env: {
      ...process.env,
      CREATE_CANVAS_SMOKE: "1",
      CREATE_CANVAS_DEV_URL: "http://127.0.0.1:3001",
      CREATE_CANVAS_USER_DATA_PATH: userData,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.locator("input[type=text]").click();
    await page.keyboard.type("mock@example.com");
    await page.locator("input[type=password]").click();
    await page.keyboard.type("test");
    await page.locator("button[type=submit]").click();
    await page.waitForFunction(() => document.body.innerText.includes("开始使用"), null, { timeout: 30000 });

    await page.getByRole("button", { name: "API 密钥" }).dispatchEvent("click");
    await page.waitForFunction(() => document.body.innerText.includes("Mock Alternate"), null, { timeout: 15000 });
    const alternateCard = page.locator("article").filter({ hasText: "Mock Alternate" });
    await alternateCard.getByRole("button", { name: /使\s*用/ }).dispatchEvent("click");
    await page.waitForFunction(() => document.body.innerText.includes("当前使用"), null, { timeout: 15000 });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "使用记录" }).dispatchEvent("click");
    await page.waitForFunction(() => document.body.innerText.includes("请求数"), null, { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("gpt-image-2"), null, { timeout: 15000 });
    await page.keyboard.press("Escape");

    console.log("MOCK_ACCOUNT_PANELS_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


