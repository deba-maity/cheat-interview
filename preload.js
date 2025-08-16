const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  sendQuestion: (q) => ipcRenderer.invoke("ask-ai", q),
});

ipcRenderer.on("answer", (event, ans) => {
  window.dispatchEvent(new CustomEvent("ai-answer", { detail: ans }));
});
