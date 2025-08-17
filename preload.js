// const { contextBridge, ipcRenderer, desktopCapturer } = require("electron");
// // const axios = require("axios");
// // const Tesseract = require("tesseract.js");
// contextBridge.exposeInMainWorld("electronAPI", {
//   ipc: ipcRenderer,
//   capture: desktopCapturer,
//   sendQuestion: (q) => ipcRenderer.invoke("ask-ai", q),
// });

// ipcRenderer.on("answer", (event, ans) => {
//   window.dispatchEvent(new CustomEvent("ai-answer", { detail: ans }));
// });

const { contextBridge, ipcRenderer, desktopCapturer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  ipc: ipcRenderer,
  capture: desktopCapturer,
  askAI: (q) => ipcRenderer.invoke("ask-ai", q),
});
