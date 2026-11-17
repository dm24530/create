(() => {
  const token = document.querySelector('meta[name="create-local-token"]')?.getAttribute("content") || "";
  const headers = { "X-Create-Local-Token": token };
  const form = document.querySelector("#settings-form");
  const status = document.querySelector("#status");
  const fields = {
    image: document.querySelector("#image-dir"),
    video: document.querySelector("#video-dir"),
    other: document.querySelector("#other-dir"),
  };
  const openFolder = document.querySelector("#open-folder-after-save");

  function setStatus(message) {
    status.textContent = message;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    return response.json();
  }

  function render(settings) {
    fields.image.value = settings.image_dir;
    fields.video.value = settings.video_dir;
    fields.other.value = settings.other_dir;
    fields.image.title = settings.image_dir;
    fields.video.title = settings.video_dir;
    fields.other.title = settings.other_dir;
    openFolder.checked = Boolean(settings.open_folder_after_save);
  }

  document.querySelectorAll("[data-choose]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const kind = button.dataset.choose;
        const result = await request(`/__local/choose-folder?kind=${kind}`, { method: "POST" });
        if (result.path) fields[kind].value = result.path;
      } catch (error) {
        setStatus(error.message);
      }
    });
  });

  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await request(`/__local/open-folder?kind=${button.dataset.open}`, { method: "POST" });
      } catch (error) {
        setStatus(error.message);
      }
    });
  });

  document.querySelector("#close").addEventListener("click", () => window.close());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const settings = await request("/__local/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_dir: fields.image.value,
          video_dir: fields.video.value,
          other_dir: fields.other.value,
          open_folder_after_save: openFolder.checked,
        }),
      });
      render(settings);
      setStatus("设置已保存。");
    } catch (error) {
      setStatus(error.message);
    }
  });

  request("/__local/settings").then(render).catch((error) => setStatus(error.message));
})();
