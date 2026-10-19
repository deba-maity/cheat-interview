"use strict";
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const asar=require("@electron/asar");
const directory=path.join(__dirname,"..","dist","win-unpacked");
const archive=path.join(directory,"resources","app.asar");
const files=asar.listPackage(archive).map(name => name.replace(/\\/g,"/"));
for (const name of ["main.js","preload.js","renderer.js","audio-capture.js","index.html","styles.css","lib/ai.js","lib/config.js","lib/key-source.js","lib/ocr-cache.js","assets/app-icon.png"]) {
  assert.ok(files.includes(`/${name}`),`Missing packaged file: ${name}`);
}
assert.ok(!files.some(name => /(^|\/)\.env($|\.)|\.enc$/.test(name)),"Secrets must not be bundled");
assert.ok(fs.existsSync(path.join(directory,"resources","lang","eng.traineddata")));
assert.ok(fs.existsSync(path.join(directory,"resources","app.asar.unpacked","node_modules","wasm-feature-detect")));
console.log("Package contents verified: UI, preload, provider modules, icon and OCR model; no bundled credentials.");
const child=spawn(path.join(directory,"Stealth Overlay.exe"),[path.join(__dirname,"check-ocr.js"),"--packaged",directory],{
  windowsHide:true,stdio:"inherit",env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},
});
child.on("exit",code => process.exit(code || 0));
child.on("error",error => {console.error(error.message);process.exit(1);});
