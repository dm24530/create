const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("createDesktop", {
  isDesktop: true,
  getRuntime: () => ipcRenderer.invoke("desktop:get-runtime"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
});
