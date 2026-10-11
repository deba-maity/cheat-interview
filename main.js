"use strict";

const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, clipboard,
  screen, session, safeStorage, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ConfigStore } = require("./lib/config");
const { AIService, AIError } = require("./lib/ai");

if (!app.isPackaged) require("dotenv").config({path:path.join(__dirname,".env"),quiet:true});
const indexURL=pathToFileURL(path.join(__dirname,"index.html")).href;
let window, tray, store, ai, ocrWorkerPromise;
let corner=0;
const requests=new Map();
const shortcutFailures=[];
let selectedDisplay="";

function notifyAction(action) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send("app-action",action);
}
function reveal() {
  if (!window || window.isDestroyed()) return;
  window.show(); window.focus();
}
function toggleVisible() {
  if (window?.isVisible()) { notifyAction("stop-listening"); window.hide(); }
  else reveal();
}
function moveCorner() {
  if (!window) return;
  const display=screen.getDisplayMatching(window.getBounds());
  const bounds=display.workArea;
  const [width,height]=window.getSize();
  corner=(corner+1)%4;
  const x=bounds.x+(corner%2 ? Math.max(0,bounds.width-width-16) : 16);
  const y=bounds.y+(corner>1 ? Math.max(0,bounds.height-height-16) : 16);
  window.setPosition(x,y);
}
function trusted(event) {
  return window && event.sender===window.webContents && event.senderFrame===window.webContents.mainFrame && event.senderFrame?.url===indexURL;
}
function publicError(error) {
  return {ok:false,error:error.message || "Request failed.",code:error.code || "APP_ERROR",attempts:error.attempts || []};
}
function handle(channel, fn) {
  ipcMain.handle(channel,async (event,payload) => {
    if (!trusted(event)) return {ok:false,error:"Untrusted caller.",code:"FORBIDDEN"};
    try { return {ok:true,...await fn(payload,event)}; }
    catch (error) { return publicError(error); }
  });
}
function validateId(id) {
  if (typeof id!=="string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new AIError("Invalid request ID.","INVALID_INPUT");
}
async function task(id, callback) {
  validateId(id);
  if (requests.has(id)) throw new AIError("This request is already running.","BUSY");
  if (requests.size>=3) throw new AIError("Too many requests are running. Wait or cancel the current request.","BUSY");
  const controller=new AbortController();
  requests.set(id,controller);
  const options={signal:controller.signal,onStatus:detail => {
    if (window && !window.isDestroyed()) window.webContents.send("request-status",{id,...detail});
  }};
  try { return await callback(options); }
  finally { requests.delete(id); }
}

async function captureScreen(displayId=selectedDisplay) {
  const sources=await desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:2560,height:1600}});
  const source=sources.find(s => s.display_id===String(displayId)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error("Screen capture is unavailable. Check screen-recording permissions.");
  return {source,image:source.thumbnail.toDataURL(),buffer:source.thumbnail.toPNG()};
}
async function ocr(buffer, signal) {
  signal?.throwIfAborted();
  if (!ocrWorkerPromise) {
    const { createWorker }=require("tesseract.js");
    ocrWorkerPromise=createWorker("eng",1,{
      langPath:app.isPackaged?path.join(process.resourcesPath,"lang"):__dirname,
      ...(app.isPackaged?{workerPath:path.join(process.resourcesPath,"app.asar.unpacked","node_modules","tesseract.js","src","worker-script","node","index.js")}:{}),
      gzip:false,cachePath:app.getPath("userData"),
    })
      .catch(error => {ocrWorkerPromise=null; throw error;});
  }
  const worker=await ocrWorkerPromise;
  signal?.throwIfAborted();
  const {data}=await worker.recognize(buffer);
  signal?.throwIfAborted();
  const text=data.text?.trim();
  if (!text) throw new AIError("No readable text was found. Select the display containing the question or configure a vision provider.","NO_SCREEN_TEXT");
  return text.slice(0,22000);
}

function registerIPC() {
  handle("get-settings",async () => ({settings:store.public(),displays:screen.getAllDisplays().map((d,i) => ({id:String(d.id),label:d.label || `Display ${i+1}`})),shortcutFailures}));
  handle("save-settings",async input => {
    const settings=store.save(input);
    ai.resetHealth();
    return {settings};
  });
  handle("ask-ai",async payload => {
    const {id,question,history,mode,language,meetingContext}=payload || {};
    return task(id,options => ai.answer(question,{history,mode,language,meetingContext,...options}));
  });
  handle("transcribe-audio",async payload => {
    const {id,audio,mimeType,language}=payload || {};
    return task(id,options => ai.transcribe(audio,{mimeType,language,...options}));
  });
  handle("screen-answer",async payload => {
    const {id,question,mode,language,history,displayId,meetingContext}=payload || {};
    return task(id,async options => {
      const captured=await captureScreen(displayId);
      if (options.signal.aborted) throw new AIError("Request cancelled.","CANCELLED");
      let visionError;
      try {
        const result=await ai.answer(question,{mode,language,history,meetingContext,image:captured.image,...options,budgetMs:30000});
        return {...result,source:"vision",display:captured.source.name};
      } catch (error) {
        if (options.signal.aborted || error.code==="CANCELLED") throw new AIError("Request cancelled.","CANCELLED");
        visionError=error;
      }
      options.onStatus({message:"Vision unavailable. Reading screen text locally…"});
      const extracted=await ocr(captured.buffer,options.signal);
      const result=await ai.answer(`${question}\n\nScreen text (OCR; may contain errors):\n${extracted}`,
        {mode,language,history,meetingContext,...options});
      return {...result,source:"ocr",display:captured.source.name,usedFallback:true,
        attempts:[...(visionError.attempts || []),...result.attempts]};
    });
  });
  handle("cancel-request",async ({id}={}) => {requests.get(id)?.abort(); return {};});
  handle("cancel-all",async () => {for (const controller of requests.values()) controller.abort(); return {};});
  handle("set-display",async ({displayId}={}) => {
    if (!screen.getAllDisplays().some(d => String(d.id)===String(displayId))) throw new Error("Display is no longer available.");
    selectedDisplay=String(displayId); return {};
  });
  handle("copy-answer",async ({text}={}) => {
    if (typeof text!=="string" || text.length>100000) throw new Error("Invalid text to copy.");
    clipboard.writeText(text); return {};
  });
  handle("window-action",async ({action}={}) => {
    if (action==="hide") {notifyAction("stop-listening");window.hide();}
    else if (action==="quit") app.quit();
    else if (action==="move") moveCorner();
    else if (action==="minimize") {notifyAction("stop-listening");window.minimize();}
    else throw new Error("Unknown window action.");
    return {};
  });
  handle("check-provider",async ({provider}={}) => {
    const id=`check-${provider}`;
    return task(id,options => ai.answer("Reply with the single word OK.",{...options,onlyProvider:provider}));
  });
}

function registerShortcuts() {
  const shortcuts={
    "CommandOrControl+L":() => {reveal();notifyAction("toggle-listening");},
    "CommandOrControl+I":() => {reveal();notifyAction("screen-answer");},
    "CommandOrControl+Enter":moveCorner,
    "CommandOrControl+D":() => notifyAction("toggle-theme"),
    "CommandOrControl+Shift+H":toggleVisible,
    "CommandOrControl+Shift+Q":() => app.quit(),
  };
  for (const [shortcut,fn] of Object.entries(shortcuts)) {
    if (!globalShortcut.register(shortcut,fn)) shortcutFailures.push(shortcut);
  }
}

function createWindow() {
  const workArea=screen.getPrimaryDisplay().workArea;
  window=new BrowserWindow({
    width:Math.min(900,workArea.width),height:Math.min(750,workArea.height),minWidth:560,minHeight:460,
    title:"Stealth Assistant",frame:false,backgroundColor:"#151B22",alwaysOnTop:true,skipTaskbar:true,show:false,
    webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,
      sandbox:true,backgroundThrottling:false,webSecurity:true},
  });
  window.setContentProtection(true);
  window.webContents.setWindowOpenHandler(() => ({action:"deny"}));
  window.webContents.on("will-navigate",event => event.preventDefault());
  window.on("closed",() => {window=null; app.quit();});
  window.once("ready-to-show",() => window?.show());
  window.loadFile(path.join(__dirname,"index.html"));
  const icon=nativeImage.createFromPath(path.join(__dirname,"assets","app-icon.png"));
  tray=new Tray(icon);
  tray.setToolTip("Stealth Assistant");
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:"Show assistant",click:reveal},{label:"Show / hide",click:toggleVisible},
    {type:"separator"},{label:"Quit",click:() => app.quit()},
  ]));
  tray.on("double-click",reveal);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance",reveal);
  app.whenReady().then(() => {
    store=new ConfigStore({directory:app.getPath("userData"),encryption:safeStorage});
    ai=new AIService(() => store.get());
    session.defaultSession.setPermissionCheckHandler((contents,permission) =>
      contents===window?.webContents && ["media","display-capture"].includes(permission));
    session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details) => {
      const audioOnly=!details.mediaTypes || details.mediaTypes.every(type => type==="audio");
      callback(contents===window?.webContents && contents.getURL()===indexURL &&
        (permission==="display-capture" || permission==="media" && audioOnly));
    });
    session.defaultSession.setDisplayMediaRequestHandler(async (request,callback) => {
      if (request.frame!==window?.webContents.mainFrame || request.frame?.url!==indexURL || !request.audioRequested) return callback({});
      try {
        const sources=await desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:1,height:1}});
        const source=sources.find(s => s.display_id===selectedDisplay) || sources[0];
        if (!source) return callback({});
        callback({video:source,audio:"loopback"});
      } catch {callback({});}
    });
    registerIPC(); createWindow(); registerShortcuts();
  }).catch(error => {console.error("Startup failed:",error.message); app.quit();});
}
app.on("before-quit",() => {
  for (const controller of requests.values()) controller.abort();
  globalShortcut.unregisterAll();
  tray?.destroy();
  if (ocrWorkerPromise) ocrWorkerPromise.then(worker => worker.terminate()).catch(() => {});
});
app.on("window-all-closed",() => app.quit());
