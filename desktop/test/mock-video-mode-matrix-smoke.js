const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const devUrl = process.env.CREATE_CANVAS_DEV_URL || "http://127.0.0.1:3003";
const mockUrl = process.env.CREATE_CANVAS_MOCK_URL || "http://127.0.0.1:9890";
const webDist = path.resolve(__dirname, "..", "..", "web", "dist-desktop");
const imageBuffer = fs.readFileSync(path.resolve(__dirname, "..", "assets", "icon.png"));

const cases = [
  { mode: "text-to-video", model: "grok-imagine-video", attachments: [] },
  { mode: "image-to-video", model: "seedance-2.0", attachments: [{ role: "首帧", kind: "image" }] },
  { mode: "first-last-frame", model: "seedance-2.0", attachments: [{ role: "参考图", kind: "image" }, { role: "首帧", kind: "image" }, { role: "尾帧", kind: "image" }], expectVisible: ["参考图1", "首帧", "尾帧"] },
  { mode: "reference-images", model: "seedance 2.5-GT", attachments: [{ role: "参考图", kind: "image" }, { role: "参考音频", kind: "audio" }] },
  { mode: "reference-video", model: "seedance 2.5-GT", attachments: [{ role: "参考图", kind: "image" }, { role: "参考视频", kind: "video" }, { role: "参考音频", kind: "audio" }] },
  { mode: "video-edit", model: "grok-imagine-video", attachments: [{ role: "视频编辑", kind: "video" }] },
  { mode: "video-extension", model: "grok-imagine-video", attachments: [{ role: "视频续写", kind: "video" }] },
  { mode: "keyframes", model: "grok-imagine-video-1.5", attachments: [{ role: "关键帧", kind: "images", count: 2 }] },
];

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

async function selectModel(page, modelName) {
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

async function addAttachment(page, attachment, buffers) {
  await preventNativeFilePicker(page);
  await page.getByRole("button", { name: "添加参考素材" }).first().click();
  await page.getByRole("button", { name: attachment.role, exact: true }).click();
  const count = attachment.count || 1;
  const files = Array.from({ length: count }, (_, index) => {
    if (attachment.kind === "image" || attachment.kind === "images") return { name: `ref-${index + 1}.png`, mimeType: "image/png", buffer: buffers.image };
    if (attachment.kind === "video") return { name: `ref-${index + 1}.webm`, mimeType: "video/webm", buffer: buffers.video };
    return { name: `ref-${index + 1}.wav`, mimeType: "audio/wav", buffer: buffers.audio };
  });
  await page.locator('input[type="file"]').last().setInputFiles(files);
  await page.getByText("选择素材用途", { exact: false }).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  if (attachment.role === "首帧") await page.getByText("首帧", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  if (attachment.role === "尾帧") await page.getByText("尾帧", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  if (attachment.role === "关键帧") await page.getByText(`关键帧${count}`, { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  if (attachment.role === "参考图") await page.getByText("参考图1", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  if (attachment.role === "参考视频") await page.getByText("视频1", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  if (attachment.role === "参考音频") await page.getByText("音频1", { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  if (attachment.role === "视频编辑" || attachment.role === "视频续写") await page.getByText("视频1", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
}

async function waitForModeRequest(mode, modelName) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mockUrl}/__mock/last-video-request`);
    const payload = await response.json();
    const request = payload?.data;
    if (request?.__mode === mode && request?.model === modelName) return request;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`request was not captured for ${mode}/${modelName}`);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-video-mode-matrix-"));
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
    const videoBuffer = await generateWebm(page);
    const audioBuffer = makeWav();

    for (const testCase of cases) {
      await page.reload();
      await page.waitForFunction(() => location.pathname === "/video" && document.body.innerText.includes("视频创作台"), null, { timeout: 20000 });
      await selectModel(page, testCase.model);
      for (const attachment of testCase.attachments) {
        await addAttachment(page, attachment, { image: imageBuffer, video: videoBuffer, audio: audioBuffer });
      }
      for (const label of testCase.expectVisible || []) {
        await page.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      }
      await page.locator("textarea:visible").first().fill(`mode matrix ${testCase.mode}`);
      await page.getByRole("button", { name: "开始生成", exact: true }).click();
      const request = await waitForModeRequest(testCase.mode, testCase.model);
      if (testCase.mode === "text-to-video" && (request.images || request.first_frame_image_url || request.last_frame_image_url || request.keyframes || request.reference_image_urls || request.reference_video_urls || request.reference_video_url)) throw new Error("text mode unexpectedly sent media");
      if (testCase.mode === "image-to-video" && (!Array.isArray(request.images) || request.images.length !== 1 || request.first_frame_image_url)) throw new Error("image mode must use images[1]");
      if (testCase.mode === "first-last-frame" && (!request.first_frame_image_url || !request.last_frame_image_url)) throw new Error("first-last mode missing frame URLs");
      if (testCase.mode === "first-last-frame" && (request.reference_image_urls || []).length) throw new Error("first-last mode should keep but not send preserved reference images");
      if (testCase.mode === "keyframes" && (!Array.isArray(request.keyframes) || request.keyframes.length !== 2 || request.keyframes.some((item, index) => item.timestamp_s !== index + 1 || !item.image_url || item.image_url.startsWith("data:")))) throw new Error("keyframes mode missing documented keyframe objects");
      if (testCase.mode === "keyframes" && request.keyframe_image_urls) throw new Error("keyframes mode used the legacy field");
      if (testCase.mode === "reference-images" && (!Array.isArray(request.reference_image_urls) || !Array.isArray(request.reference_audio_urls))) throw new Error("reference-images mode missing references");
      if (testCase.mode === "reference-video" && (!Array.isArray(request.reference_image_urls) || !Array.isArray(request.reference_video_urls) || !Array.isArray(request.reference_audio_urls))) throw new Error("reference-video mode missing references");
      if (testCase.mode === "video-edit" || testCase.mode === "video-extension") {
        if (request.mode !== testCase.mode || typeof request.reference_video_url !== "string" || !request.reference_video_url) throw new Error(`${testCase.mode} mode missing documented reference_video_url`);
        if (request.reference_video_urls) throw new Error(`${testCase.mode} mode used the wrong reference_video_urls field`);
        if (request.reference_image_urls || request.reference_audio_urls) throw new Error(`${testCase.mode} mode sent media fields the doc does not allow`);
      }
      console.log(`VIDEO_MODE_APP_OK ${testCase.mode} ${testCase.model}`);
    }
    console.log(`VIDEO_MODE_MATRIX_APP_OK ${cases.length}/${cases.length}`);
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
