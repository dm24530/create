const path = require("node:path");
const { _electron: electron } = require("playwright-core");
(async () => {
  const exe = path.resolve(__dirname, "..", "release", "win-unpacked", "Create.exe");
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, CREATE_CANVAS_SMOKE: "1" } });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.locator('[data-testid="create-login-form"], [data-testid="image-workbench"]').first().waitFor({ timeout: 15000 });
    console.log("PACKAGED_SMOKE_OK");
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
