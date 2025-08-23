const { contextBridge, ipcRenderer, desktopCapturer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  ipc: ipcRenderer,
  capture: desktopCapturer,
  askAI: (q) => ipcRenderer.invoke("ask-ai", q),
});
