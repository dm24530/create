const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("createDesktop", {
  isDesktop: true,
  getRuntime: () => ipcRenderer.invoke("desktop:get-runtime"),
  checkForUpdates: (metadataUrl) => ipcRenderer.invoke("desktop:check-updates", metadataUrl),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
  getSkippedUpdateVersion: () => ipcRenderer.invoke("desktop:get-skipped-update-version"),
  setSkippedUpdateVersion: (version) => ipcRenderer.invoke("desktop:set-skipped-update-version", version),
  clearSkippedUpdateVersion: () => ipcRenderer.invoke("desktop:clear-skipped-update-version"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  getSaveSettings: () => ipcRenderer.invoke("desktop:get-save-settings"),
  saveSaveSettings: (settings) => ipcRenderer.invoke("desktop:save-save-settings", settings),
  saveGeneratedFile: (payload) => ipcRenderer.invoke("desktop:save-generated-file", payload),
  readGeneratedFile: (payload) => ipcRenderer.invoke("desktop:read-generated-file", payload),
  deleteGeneratedFile: (payload) => ipcRenderer.invoke("desktop:delete-generated-file", payload),
  chooseSaveDirectory: (kind) => ipcRenderer.invoke("desktop:choose-save-directory", kind),
  openSaveFolder: (kind) => ipcRenderer.invoke("desktop:open-save-folder", kind),
  onOpenSaveSettings: (callback) => {
    if (typeof callback !== "function") return () => undefined;
    const listener = () => callback();
    ipcRenderer.on("desktop:open-save-settings", listener);
    return () => ipcRenderer.removeListener("desktop:open-save-settings", listener);
  },
  onDownloadComplete: (callback) => {
    if (typeof callback !== "function") return () => undefined;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:download-complete", listener);
    return () => ipcRenderer.removeListener("desktop:download-complete", listener);
  },
  onUpdateEvent: (callback) => {
    if (typeof callback !== "function") return () => undefined;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:update-event", listener);
    return () => ipcRenderer.removeListener("desktop:update-event", listener);
  },
});
