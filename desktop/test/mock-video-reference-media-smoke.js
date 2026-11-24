const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const mockUrl = process.env.CREATE_CANVAS_MOCK_URL || "http://127.0.0.1:9890";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");
const modelName = "seedance 2.5-GT";
const png = fs.readFileSync(path.resolve(__dirname, "..", "assets", "icon.png"));

function makeWav() {
  const sampleRate = 8000;
  const samples = 20000;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index / 10) * 2000), 44 + index * 2);
  return buffer;
}

async function generateWebm(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas context unavailable");
    context.fillStyle = "#336699";
    context.fillRect(0, 0, 32, 32);
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 250));
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
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
  return settingsPath;
}

async function selectModel(page) {
  const combobox = page.getByRole("combobox", { name: "视频模型" });
  await combobox.click();
  await combobox.fill("");
  await combobox.pressSequentially(modelName, { delay: 2 });
  await page.waitForTimeout(100);
  await combobox.press("Enter");
  await page.waitForFunction((name) => {
    const input = document.querySelector('input[aria-label="视频模型"]');
    return input?.closest(".ant-select")?.textContent?.includes(name);
  }, modelName, { timeout: 10000 });
}

async function waitForRequest(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mockUrl}/__mock/last-video-request`);
    const payload = await response.json();
    if (payload?.data?.model === modelName) return payload.data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const references = await (await fetch(`${mockUrl}/__mock/reference-assets`)).json();
  const bodyText = await page.locator("body").innerText();
  throw new Error(`reference-media request was not captured; uploads=${JSON.stringify(references.data)}; uiTail=${bodyText.slice(-2500)}`);
}

async function preventNativeFilePicker(page) {
  await page.evaluate(() => {
    if (window.__createFilePickerStubbed) return;
    window.__createFilePickerStubbed = true;
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function (...args) {
      if (this instanceof HTMLInputElement && this.type === "file") return;
      return originalClick.apply(this, args);
    };
  });
}

async function addRoleFile(page, role, file) {
  await preventNativeFilePicker(page);
  await page.getByRole("button", { name: "添加参考素材" }).first().click();
  await page.getByRole("button", { name: role, exact: true }).click();
  await page.locator('input[type="file"]').last().setInputFiles([file]);
  await page.getByText("选择素材用途", { exact: false }).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-video-reference-media-"));
  const settingsPath = makeSettings(root);
  const userData = path.join(root, "user-data");
  fs.mkdirSync(userData, { recursive: true });
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
      CREATE_CANVAS_SETTINGS_PATH: settingsPath,
    },
  });
  try {
    const page = await app.firstWindow();
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
    if (new URL(page.url()).pathname !== "/video") await page.locator('a[href="/video"]').click();
    await page.waitForFunction(() => location.pathname === "/video" && document.body.innerText.includes("视频创作台"), null, { timeout: 20000 });
    await selectModel(page);
    const videoBuffer = await generateWebm(page);
    const audioBuffer = makeWav();

    await addRoleFile(page, "参考图", { name: "ref.png", mimeType: "image/png", buffer: png });
    await page.getByText("参考图1", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    await addRoleFile(page, "参考视频", { name: "ref.webm", mimeType: "video/webm", buffer: videoBuffer });
    await page.getByText("视频1", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    await addRoleFile(page, "参考音频", { name: "ref.wav", mimeType: "audio/wav", buffer: audioBuffer });
    await page.getByText("音频1", { exact: true }).waitFor({ state: "visible", timeout: 15000 });

    await page.locator("textarea:visible").first().fill("mock capability reference media");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const request = await waitForRequest(page);
    if (request.__mode !== "reference-video") throw new Error(`unexpected mode ${request.__mode}`);
    if (!Array.isArray(request.reference_image_urls) || request.reference_image_urls.length !== 1) throw new Error("reference image URL missing");
    if (!Array.isArray(request.reference_video_urls) || request.reference_video_urls.length !== 1) throw new Error("reference video URL missing");
    if (!Array.isArray(request.reference_audio_urls) || request.reference_audio_urls.length !== 1) throw new Error("reference audio URL missing");
    if (!request.reference_image_urls[0].includes("/reference/image/")) throw new Error("image upload did not return a mock URL");
    if (!request.reference_video_urls[0].includes("/reference/video/")) throw new Error("video upload did not return a mock URL");
    if (!request.reference_audio_urls[0].includes("/reference/audio/")) throw new Error("audio upload did not return a mock URL");
    console.log("VIDEO_REFERENCE_MEDIA_APP_OK image=1 video=1 audio=1");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
