"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {OCRCache}=require("../lib/ocr-cache");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(recognize=async()=>({data:{text:"result"}})) {
  let creates=0,terminations=0,idle;
  const cache=new OCRCache(async()=>{creates++;return {recognize,terminate:async()=>{terminations++;}};},{
    schedule:(callback,ms)=>{idle={callback,ms};return 1;},unschedule:()=>{idle=null;},
  });
  return {cache,get creates(){return creates;},get terminations(){return terminations;},get idle(){return idle;}};
}
test("OCR is lazy, reused briefly, then releases its worker and creates a fresh one on demand",async()=>{
  const f=fixture();assert.equal(f.creates,0);
  await f.cache.recognize(Buffer.from("first"));await f.cache.recognize(Buffer.from("second"));
  assert.equal(f.creates,1);assert.equal(f.idle.ms,15000);
  f.idle.callback();await tick();assert.equal(f.terminations,1);assert.equal(f.cache.lease,null);
  await f.cache.recognize(Buffer.from("third"));assert.equal(f.creates,2);
  f.cache.dispose();await tick();assert.equal(f.terminations,2);
});
test("cancel terminates CPU-bound OCR immediately instead of waiting for recognition",async()=>{
  const f=fixture(()=>new Promise(()=>{}));const controller=new AbortController();
  const work=f.cache.recognize(Buffer.from("image"),controller.signal);await tick();
  controller.abort();await assert.rejects(work,/abort/i);await tick();
  assert.equal(f.terminations,1);assert.equal(f.cache.lease,null);assert.equal(f.cache.job,null);
});
test("cancelling during worker creation disposes that worker once it arrives",async()=>{
  let release,terminated=0,recognized=0;
  const cache=new OCRCache(()=>new Promise(resolve=>{release=resolve;}));
  const controller=new AbortController();const work=cache.recognize(Buffer.from("image"),controller.signal);
  await tick();controller.abort();await assert.rejects(work);
  release({recognize(){recognized++;},terminate(){terminated++;return Promise.resolve();}});
  await tick();assert.equal(terminated,1);assert.equal(recognized,0);
});
test("concurrent recognition is rejected instead of starting more workers",async()=>{
  let complete;
  const f=fixture(()=>new Promise(resolve=>{complete=resolve;}));
  const first=f.cache.recognize(Buffer.from("one"));await tick();
  await assert.rejects(f.cache.recognize(Buffer.from("two")),/already running/);
  complete({data:{text:"done"}});await first;assert.equal(f.creates,1);f.cache.dispose();
});
