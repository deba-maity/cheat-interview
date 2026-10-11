"use strict";
const {app,desktopCapturer,nativeImage,screen}=require("electron");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {setTimeout:wait}=require("node:timers/promises");
const directory=process.env.STEALTH_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(),"assistant-ui-test-"));
app.setPath("userData",directory);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
for (const provider of ["GROQ","OPENAI","GEMINI","OPENROUTER"]) {
  process.env[`${provider}_API_KEY`]="";process.env[`${provider}_API_KEYS`]="";
}
process.env.GROQ_API_KEY="test-only-ui-key";
let window;
const errors=[],calls=[],chatBodies=[];
globalThis.fetch=async (url,req) => {
  calls.push(url);
  if (url.endsWith("audio/transcriptions")) {
    assert.ok(req.body.get("file").size>128,"Audio upload should contain encoded data");
    assert.equal(req.body.get("model"),"whisper-large-v3-turbo");
    return new Response(JSON.stringify({text:"What is a promise in JavaScript?"}),{status:200});
  }
  const body=JSON.parse(req.body);chatBodies.push(body);
  if (body.messages.at(-1).content==="Hang request") return new Promise((_resolve,reject) => req.signal.addEventListener("abort",() => reject(Error("cancelled")),{once:true}));
  return new Response(JSON.stringify({choices:[{message:{content:"A promise represents a future result.\n\n```javascript\nconst result = await Promise.resolve(42);\n```\n<img src=x onerror=alert(1)>"},finish_reason:"stop"}]}),{status:200});
};
app.on("browser-window-created",(_event,created) => {
  window=created;
  window.show=() => {};
  window.webContents.on("console-message",(_event,level,message) => {
    if (level===3) errors.push(message);
  });
});
require("../main.js");
const exec=script => window.webContents.executeJavaScript(script,true);
async function until(script,timeout=12000) {
  const start=Date.now();
  while (Date.now()-start<timeout) {if (await exec(script)) return;await wait(100);}
  throw Error(`Timed out: ${script}`);
}
const guard=setTimeout(() => {console.error("UI smoke test timeout");app.exit(1);},45000);
app.whenReady().then(async () => {
  try {
    await until("Boolean(window.electronAPI && document.getElementById('configurationHint')?.textContent.includes('configured'))");
    assert.equal(await exec("typeof window.electronAPI.ipc"),"undefined","Raw IPC must not be exposed");
    assert.equal(window.isContentProtected(),true,"Screen capture protection must be enabled");
    await exec("document.getElementById('questionBox').value='What is a promise?';document.getElementById('questionForm').requestSubmit()");
    await until("document.querySelectorAll('.message.assistant').length===1");
    assert.equal(await exec("document.querySelectorAll('.message pre code').length"),1);
    assert.equal(await exec("document.querySelectorAll('#output img').length"),0,"Model output must not become executable HTML");
    await exec("document.getElementById('themeButton').click()");
    assert.equal(await exec("document.body.classList.contains('light')"),true);
    await exec("document.getElementById('settingsButton').click()");
    await until("document.getElementById('settingsDialog').open");
    assert.equal(await exec("document.querySelectorAll('.provider-card').length"),4);
    await exec("document.getElementById('groq-keys').value='replacement-test-key';document.getElementById('saveSettings').click()");
    await until("!document.getElementById('settingsDialog').open");
    assert.equal(fs.readFileSync(path.join(directory,"provider-settings.enc")).includes(Buffer.from("replacement-test-key")),false);
    await exec("document.getElementById('listenButton').click()");
    await until("document.getElementById('listenButton').classList.contains('recording')");
    await wait(1700);
    await exec("document.getElementById('listenButton').click()");
    await until("document.querySelectorAll('.message.transcript').length>0");
    await until("document.querySelectorAll('.message.assistant').length===2");
    await until("!document.getElementById('listenButton').classList.contains('recording') && !document.getElementById('sendButton').disabled");
    assert.ok(calls.some(url => url.endsWith("audio/transcriptions")));
    assert.ok(chatBodies.at(-1).messages.some(m => typeof m.content==="string" && m.content.includes("Recent meeting transcript")),"Transcribed context should be retained");
    const realSources=desktopCapturer.getSources;
    desktopCapturer.getSources=async () => [{display_id:String(screen.getPrimaryDisplay().id),name:"Fixture display",thumbnail:nativeImage.createFromPath(path.join(__dirname,"..","test","fixtures","question.png"))}];
    await exec("document.getElementById('modeSelect').value='coding';document.getElementById('modeSelect').dispatchEvent(new Event('change'));document.getElementById('languageSelect').value='Python';document.getElementById('screenButton').click()");
    await until("document.querySelectorAll('.message.assistant').length===3",20000);
    assert.match(await exec("document.querySelectorAll('.message.assistant')[2].textContent"),/OCR/);
    assert.ok(chatBodies.at(-1).messages.at(-1).content.includes("Two Sum"),"OCR fallback should include the extracted problem");
    assert.match(chatBodies.at(-1).messages[0].content,/Python/);
    await exec("window.electronAPI.saveSettings({providers:{gemini:{keys:'vision-test-key'}}})");
    await exec("document.getElementById('screenButton').click()");
    await until("document.querySelectorAll('.message.assistant').length===4");
    assert.match(await exec("document.querySelectorAll('.message.assistant')[3].textContent"),/VISION/);
    assert.equal(chatBodies.at(-1).messages.at(-1).content[1].type,"image_url");
    desktopCapturer.getSources=realSources;
    await exec("document.getElementById('questionBox').value='Hang request';document.getElementById('questionForm').requestSubmit()");
    await until("document.getElementById('sendButton').disabled");
    await exec("document.getElementById('cancelButton').click()");
    await until("!document.getElementById('sendButton').disabled");
    assert.match(await exec("document.getElementById('statusText').textContent"),/Cancelled/);
    assert.equal(await exec("document.querySelectorAll('.message.assistant').length"),4);
    await wait(300);
    const screenshot=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    const artifacts=path.join(__dirname,"..","test-artifacts");fs.mkdirSync(artifacts,{recursive:true});
    fs.writeFileSync(path.join(artifacts,"assistant-ui.png"),screenshot.toPNG());
    assert.deepEqual(errors,[],"Renderer should not log script or CSP errors");
    console.log("UI smoke test passed: actual main/preload IPC, capture protection, safe code rendering, encrypted settings, theme, synthetic microphone, transcription/context/auto-answer, vision, real offline OCR fallback, coding mode and cancellation.");
    clearTimeout(guard);app.exit(0);
  } catch (error) {console.error(error.stack);console.error("Renderer errors:",errors);clearTimeout(guard);app.exit(1);}
});
