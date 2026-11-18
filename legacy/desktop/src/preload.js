const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("createDesktop", {
  isDesktop: true,
  getRuntime: () => ipcRenderer.invoke("desktop:get-runtime"),
  openSettings: () => ipcRenderer.invoke("desktop:open-settings"),
  onDownloadComplete: (callback) => {
    if (typeof callback !== "function") return () => undefined;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:download-complete", listener);
    return () => ipcRenderer.removeListener("desktop:download-complete", listener);
  },
});
