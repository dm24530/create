const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const productImagePath = path.resolve(__dirname, "..", "assets", "icon.png");

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-product-detail-smoke-"));
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
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("create-login-form").waitFor({ timeout: 15000 });
    await page.locator("input[type=text]").click();
    await page.keyboard.type("mock@example.com");
    await page.locator("input[type=password]").click();
    await page.keyboard.type("test");
    await page.locator("button[type=submit]").click();
    try {
      await page.getByTestId("image-workbench").waitFor({ timeout: 30000 });
    } catch (error) {
      console.error("LOGIN_BODY", await page.locator("body").innerText());
      console.error("LOGIN_ERRORS", errors.join(" | "));
      throw error;
    }

    await page.locator('a[href="/product-detail"]').first().click();
    await page.waitForFunction(() => location.pathname === "/product-detail", null, { timeout: 15000 });
    const workbench = page.getByTestId("product-detail-workbench");
    await workbench.waitFor({ timeout: 15000 });
    await workbench.getByRole("main").getByRole("button", { name: "新建详情页", exact: true }).click();

    const productInput = workbench.locator('input[type=file][accept="image/*"]').first();
    await productInput.setInputFiles({ name: "product.png", mimeType: "image/png", buffer: fs.readFileSync(productImagePath) });
    await workbench.locator("[data-composer-attachments]").waitFor({ state: "visible", timeout: 15000 });
    if (!(await workbench.locator("[data-composer-attachments]").innerText()).includes("商品图")) {
      throw new Error("product image was not attached to the composer");
    }

    const composer = page.locator("textarea:visible").last();
    await composer.fill("商品是一款便携榨汁杯，目标人群是上班族，核心卖点是一键榨汁，平台淘宝。");
    await composer.press("Enter");

    try {
      await page.getByText("确认商品详情页信息", { exact: true }).waitFor({ timeout: 30000 });
    } catch (error) {
      console.error("BRIEF_DIALOG_BODY", await page.locator("body").innerText());
      console.error("BRIEF_DIALOG_ERRORS", errors.join(" | "));
      throw error;
    }
    await page.getByRole("button", { name: "确认并生成分镜", exact: true }).click();
    await page.getByRole("button", { name: "确认分镜", exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "确认分镜", exact: true }).click();
    await page.getByRole("button", { name: "生成全部底图", exact: true }).click();

    try {
      await page.waitForFunction(() => document.body.innerText.includes("等待检查"), null, { timeout: 60000 });
    } catch (error) {
      console.error("PRODUCT_DETAIL_BODY", await page.locator("body").innerText());
      console.error("PRODUCT_DETAIL_ERRORS", errors.join(" | "));
      throw error;
    }
    await page.waitForTimeout(1000);
    const resultText = await page.locator("body").innerText();
    if (!resultText.includes("Mock 便携榨汁杯")) throw new Error("product detail brief was not persisted");
    if (!resultText.includes("等待检查")) throw new Error("product detail did not enter review status");

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => document.body.innerText.includes("Mock 便携榨汁杯") && document.body.innerText.includes("等待检查"), null, { timeout: 30000 });
    await page.getByRole("button", { name: "项目工作区", exact: true }).click();
    await page.getByRole("tab", { name: "生成结果", exact: true }).click();
    await page.waitForFunction(() => /6\s*\/\s*6\s*页已生成底图/.test(document.body.innerText), null, { timeout: 30000 });
    const unexpectedErrors = errors.filter((message) => !message.includes("favicon") && !message.includes("maskClosable") && !message.includes("501 (Not Implemented)"));
    if (unexpectedErrors.length) throw new Error(`page errors: ${unexpectedErrors.join(" | ")}`);
    if (process.env.CREATE_QA_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.CREATE_QA_SCREENSHOT_DIR, { recursive: true });
      const screenshotPath = path.join(process.env.CREATE_QA_SCREENSHOT_DIR, "product-detail-review.png");
      try {
        await page.screenshot({ path: screenshotPath, animations: "disabled", caret: "hide", timeout: 15000 });
      } catch {
        const base64 = await app.evaluate(async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find(Boolean);
          if (!win) throw new Error("window missing");
          win.show();
          await new Promise((resolve) => setTimeout(resolve, 300));
          return (await win.webContents.capturePage()).toPNG().toString("base64");
        });
        fs.writeFileSync(screenshotPath, Buffer.from(base64, "base64"));
      }
    }
    console.log("MOCK_PRODUCT_DETAIL_FLOW_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});