const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-canvas-smoke-"));
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, ".."),
    executablePath: require("electron"),
    env: {
      ...process.env,
      CREATE_CANVAS_SMOKE: "1",
      CREATE_CANVAS_DEV_URL: process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3001",
      CREATE_CANVAS_WEB_DIST: path.resolve(__dirname, "..", "..", "web", "dist-desktop"),
      CREATE_CANVAS_USER_DATA_PATH: userData,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByText("欢迎回来").waitFor({ timeout: 15000 });
    await page.locator("input[type=text]").click();
    await page.keyboard.type("mock@example.com");
    await page.locator("input[type=password]").click();
    await page.keyboard.type("test");
    await page.locator("button[type=submit]").click();
    await page.waitForFunction(() => location.pathname === "/image" && document.body.innerText.includes("生图工作台"), null, { timeout: 30000 });
    await page.locator('a[href="/canvas"]').click();
    await page.waitForFunction(() => document.body.innerText.includes("新建画布"), null, { timeout: 15000 });
    await page.getByRole("button", { name: "新建画布" }).first().click();
    await page.waitForURL(/\/canvas\/[^/]+/, { timeout: 15000 });
    const projectId = new URL(page.url()).pathname.split("/").pop();
    await page.waitForTimeout(2000);
    await page.goto(new URL("/canvas", page.url()).toString());
    await page.waitForFunction(() => document.body.innerText.includes("0 个节点"), null, { timeout: 15000 });
    const localValues = await page.evaluate(() => Object.keys(localStorage).map((key) => localStorage.getItem(key) || ""));
    if (!localValues.some((value) => value.includes(projectId))) throw new Error("local canvas project was not persisted");
    const mockApi = process.env.CREATE_CANVAS_MOCK_URL || "http://127.0.0.1:9890";
    const cloud = await (await fetch(`${mockApi}/api/v1/canvas/projects`)).json();
    if (!Array.isArray(cloud.data)) throw new Error("mock cloud project list is malformed");
    if (cloud.data.some((project) => project.id === projectId)) throw new Error("desktop canvas leaked into cloud canvas storage");
    console.log("MOCK_LOGIN_LOCAL_CANVAS_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
