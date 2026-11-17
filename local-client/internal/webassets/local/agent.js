(() => {
  const tokenMeta = document.querySelector('meta[name="create-local-token"]');
  const token = tokenMeta?.getAttribute("content") || "";
  if (!token) return;

  window.__CREATE_LOCAL__ = { isLocal: true };
  const localHeaders = { "X-Create-Local-Token": token };

  function classify(filename, contentType) {
    const type = String(contentType || "").toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    const ext = String(filename || "").split(".").pop()?.toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"].includes(ext)) return "image";
    if (["mp4", "webm", "mov", "mkv", "m4v"].includes(ext)) return "video";
    return "other";
  }

  async function saveDownload(anchor) {
    const href = anchor.href;
    if (!href) return false;
    const filename = anchor.download || "download.bin";
    const response = await fetch(href, { credentials: "include" });
    if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);
    const blob = await response.blob();
    const kind = classify(filename, blob.type);
    const saved = await fetch(`/__local/save?kind=${kind}&filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
        "X-Create-Local-Token": token,
      },
      body: blob,
      credentials: "same-origin",
    });
    if (!saved.ok) throw new Error((await saved.text()) || `保存失败: HTTP ${saved.status}`);
    return true;
  }

  document.addEventListener("click", async (event) => {
    const anchor = event.target?.closest?.("a[download]");
    if (!anchor) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await saveDownload(anchor);
    } catch (error) {
      console.error("Create local save failed", error);
      alert(error instanceof Error ? error.message : String(error));
    }
  }, true);

  window.addEventListener("DOMContentLoaded", () => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "本地保存";
    button.title = "设置图片和视频的本地保存目录";
    Object.assign(button.style, {
      position: "fixed",
      left: "14px",
      bottom: "14px",
      zIndex: "2147483647",
      border: "1px solid rgba(249,115,22,.55)",
      borderRadius: "8px",
      background: "rgba(28,25,23,.92)",
      color: "#fff7ed",
      padding: "8px 12px",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 8px 28px rgba(0,0,0,.24)",
    });
    button.addEventListener("click", () => window.open("/__local/settings", "_blank"));
    document.body.appendChild(button);

    void fetch("/__local/update-status", { headers: localHeaders })
      .then((response) => response.ok ? response.json() : null)
      .then((status) => {
        if (!status?.available) return;
        const banner = document.createElement("div");
        Object.assign(banner.style, {
          position: "fixed",
          right: "14px",
          bottom: "14px",
          zIndex: "2147483647",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          border: "1px solid rgba(249,115,22,.5)",
          borderRadius: "9px",
          background: "rgba(28,25,23,.95)",
          color: "#fff7ed",
          padding: "9px 10px 9px 12px",
          fontSize: "12px",
          boxShadow: "0 10px 32px rgba(0,0,0,.28)",
        });
        const label = document.createElement("span");
        label.textContent = `Create ${status.latest} 可更新`;
        const updateButton = document.createElement("button");
        updateButton.type = "button";
        updateButton.textContent = "更新";
        Object.assign(updateButton.style, {
          border: "0",
          borderRadius: "6px",
          background: "#f97316",
          color: "#111827",
          padding: "6px 10px",
          font: "inherit",
          fontWeight: "700",
          cursor: "pointer",
        });
        updateButton.addEventListener("click", async () => {
          updateButton.disabled = true;
          updateButton.textContent = "下载中…";
          try {
            const response = await fetch("/__local/update", { method: "POST", headers: localHeaders });
            if (!response.ok) throw new Error(await response.text());
            label.textContent = "更新已下载，正在重启…";
            updateButton.remove();
          } catch (error) {
            updateButton.disabled = false;
            updateButton.textContent = "重试";
            label.textContent = error instanceof Error ? error.message : String(error);
          }
        });
        banner.append(label, updateButton);
        document.body.appendChild(banner);
      })
      .catch(() => undefined);
  });
})();
