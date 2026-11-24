const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "create-desktop-smoke-"));
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, ".."),
    executablePath: require("electron"),
    env: {
      ...process.env,
      CREATE_CANVAS_SMOKE: "1",
      CREATE_CANVAS_WEB_DIST: path.resolve(__dirname, "..", "..", "web", "dist-desktop"),
      CREATE_CANVAS_USER_DATA_PATH: userData,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("create-login-form").waitFor({ timeout: 15000 });
    console.log("SMOKE_OK");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
