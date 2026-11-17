const bridge = window.createDesktopSettings;
const form = document.querySelector("#settings-form");
const imageDir = document.querySelector("#image-dir");
const videoDir = document.querySelector("#video-dir");
const otherDir = document.querySelector("#other-dir");
const openFolderAfterSave = document.querySelector("#open-folder-after-save");
const status = document.querySelector("#status");
const saveButton = document.querySelector("#save");

let currentSettings = null;

function setStatus(message, tone = "") {
  status.textContent = message;
  status.className = `status ${tone}`.trim();
}

function render(settings) {
  currentSettings = settings;
  imageDir.value = settings.imageDir;
  videoDir.value = settings.videoDir;
  otherDir.value = settings.otherDir;
  openFolderAfterSave.checked = settings.openFolderAfterSave;
  imageDir.title = settings.imageDir;
  videoDir.title = settings.videoDir;
  otherDir.title = settings.otherDir;
}

function inputFor(kind) {
  if (kind === "image") return imageDir;
  if (kind === "video") return videoDir;
  return otherDir;
}

document.querySelectorAll("[data-choose]").forEach((button) => {
  button.addEventListener("click", async () => {
    const kind = button.dataset.choose;
    const selected = await bridge.chooseFolder(kind);
    if (selected) inputFor(kind).value = selected;
  });
});

document.querySelectorAll("[data-open]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await bridge.openFolder(button.dataset.open);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  });
});

document.querySelector("#cancel").addEventListener("click", () => bridge.close());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  setStatus("正在保存…");
  try {
    const result = await bridge.save({
      ...currentSettings,
      imageDir: imageDir.value,
      videoDir: videoDir.value,
      otherDir: otherDir.value,
      openFolderAfterSave: openFolderAfterSave.checked,
    });
    render(result.settings);
    setStatus("设置已保存。", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    saveButton.disabled = false;
  }
});

void bridge.get().then(render).catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), "error");
});
