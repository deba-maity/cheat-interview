"use strict";
const path=require("node:path");
const fs=require("node:fs");
const assert=require("node:assert/strict");
const packageIndex=process.argv.indexOf("--packaged");
const packageDirectory=packageIndex>=0?path.resolve(process.argv[packageIndex+1]):null;
const moduleRoot=packageDirectory?path.join(packageDirectory,"resources","app.asar.unpacked","node_modules"):null;
const {createWorker}=require(moduleRoot?path.join(moduleRoot,"tesseract.js"):"tesseract.js");
async function check() {
  const cache=path.join(__dirname,"..","test-artifacts","ocr-cache");fs.mkdirSync(cache,{recursive:true});
  const worker=await createWorker("eng",1,{
    langPath:packageDirectory?path.join(packageDirectory,"resources","lang"):path.join(__dirname,".."),
    ...(moduleRoot?{workerPath:path.join(moduleRoot,"tesseract.js","src","worker-script","node","index.js")}:{}),
    gzip:false,cachePath:cache,
  });
  try {
    const {data}=await worker.recognize(path.join(__dirname,"..","test","fixtures","question.png"));
    assert.match(data.text,/Two Sum/i);assert.match(data.text,/target/i);
    console.log(`${packageDirectory?"Packaged":"Offline"} OCR passed (${Math.round(data.confidence)}% confidence): ${data.text.trim().split("\n")[0]}`);
  } finally {await worker.terminate();}
}
check().catch(error => {console.error(error.message);process.exitCode=1;});
