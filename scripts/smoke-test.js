"use strict";
const {spawn}=require("node:child_process");
const path=require("node:path");
const fs=require("node:fs");
const os=require("node:os");
const electron=require("electron");
// Test windows stay hidden; synthetic devices are used, never the real microphone.
const env=Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase()!=="ELECTRON_RUN_AS_NODE"));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"assistant-ui-test-"));
env.STEALTH_TEST_PROFILE=profile;
const child=spawn(electron,[path.join(__dirname,"smoke-main.js")],{
  cwd:path.join(__dirname,".."),windowsHide:true,stdio:"inherit",env,
});
child.on("exit",code => {
  const resolved=path.resolve(profile);
  if (resolved.startsWith(path.resolve(os.tmpdir())+path.sep) && path.basename(resolved).startsWith("assistant-ui-test-")) {
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:200});
  }
  process.exit(code || 0);
});
child.on("error",error => {console.error(error.message);process.exit(1);});
