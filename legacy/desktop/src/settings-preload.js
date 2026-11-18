const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("createDesktopSettings", {
  get: () => ipcRenderer.invoke("desktop:get-settings"),
  chooseFolder: (kind) => ipcRenderer.invoke("desktop-settings:choose-folder", kind),
  save: (settings) => ipcRenderer.invoke("desktop-settings:save", settings),
  openFolder: (kind) => ipcRenderer.invoke("desktop:open-save-folder", kind),
  close: () => ipcRenderer.invoke("desktop-settings:close"),
});
