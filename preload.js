"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const subscribe = channel => callback => {
  if (typeof callback!=="function") throw new TypeError("Callback required.");
  const listener=(_event,payload) => callback(payload);
  ipcRenderer.on(channel,listener);
  return () => ipcRenderer.removeListener(channel,listener);
};
contextBridge.exposeInMainWorld("electronAPI",{
  askAI:payload => ipcRenderer.invoke("ask-ai",payload),
  transcribe:payload => ipcRenderer.invoke("transcribe-audio",payload),
  answerScreen:payload => ipcRenderer.invoke("screen-answer",payload),
  getSettings:() => ipcRenderer.invoke("get-settings"),
  saveSettings:payload => ipcRenderer.invoke("save-settings",payload),
  checkProvider:provider => ipcRenderer.invoke("check-provider",{provider}),
  cancelRequest:id => ipcRenderer.invoke("cancel-request",{id}),
  cancelAll:() => ipcRenderer.invoke("cancel-all"),
  setDisplay:displayId => ipcRenderer.invoke("set-display",{displayId}),
  copyAnswer:text => ipcRenderer.invoke("copy-answer",{text}),
  windowAction:action => ipcRenderer.invoke("window-action",{action}),
  onAction:subscribe("app-action"),onStatus:subscribe("request-status"),
});
