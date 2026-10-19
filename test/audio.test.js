"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const settle=() => new Promise(resolve => setImmediate(resolve));

function fixture({systemAudio=true,micError=false,slowResume=false}={}) {
  let clock=0,level=.1,intervalMs;
  const recorders=[],streams=[],clips=[],errors=[],notices=[],contexts=[];
  class Track {constructor(kind){this.kind=kind;this.stopped=false;}stop(){this.stopped=true;}}
  class Stream {
    constructor(tracks=[new Track("audio")]) {this.tracks=tracks;streams.push(this);}
    getTracks(){return this.tracks;} getAudioTracks(){return this.tracks.filter(t => t.kind==="audio");}
  }
  class Recorder {
    static isTypeSupported(){return true;}
    constructor(stream,opts){this.options=opts;this.stream=stream;this.mimeType=opts?.mimeType || "audio/webm";recorders.push(this);}
    start(timeslice){this.timeslice=timeslice;this.state="recording";}
    stop(){this.state="inactive";queueMicrotask(() => {this.ondataavailable?.({data:new Blob([`header-${recorders.indexOf(this)}:${"a".repeat(300)}`])});this.onstop?.();});}
  }
  class AudioContext {
    constructor(options){this.options=options;contexts.push(this);}
    resume(){if (slowResume && contexts.length===1) return new Promise(resolve => {this.resumeResolve=resolve;});return Promise.resolve();}
    close(){this.closed=true;return Promise.resolve();}
    createMediaStreamDestination(){return {stream:new Stream()};}
    createAnalyser(){return {fftSize:0,getFloatTimeDomainData:samples => samples.fill(level)};}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
  }
  const sandbox={window:{AudioContext},navigator:{mediaDevices:{
    getUserMedia:async () => {if (micError) {const e=Error("Denied");e.name="NotAllowedError";throw e;}return new Stream();},
    getDisplayMedia:async () => new Stream(systemAudio?[new Track("audio"),new Track("video")]:[new Track("video")]),
  }},MediaRecorder:Recorder,MediaStream:Stream,Blob,performance:{now:() => clock},
    Float32Array,setInterval:(_fn,ms) => {intervalMs=ms;return 1;},clearInterval(){},queueMicrotask};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../audio-capture.js"),"utf8"),sandbox);
  const capture=new sandbox.window.AudioCapture({onClip:clip => clips.push(clip),onError:e => errors.push(e),onNotice:n => notices.push(n)});
  return {capture,recorders,streams,clips,errors,notices,contexts,
    get intervalMs(){return intervalMs;},
    tick:(ms,rms=.1) => {clock+=ms;level=rms;capture.monitor();}};
}

test("speech clips finalize after silence and each clip is its own recorder session",async () => {
  const f=fixture();await f.capture.start();
  for (let i=0;i<6;i++) f.tick(50);
  f.tick(1300,0);await settle();
  assert.equal(f.clips.length,1);assert.equal(f.recorders.length,2);
  assert.match(await f.clips[0].text(),/^header-0:/);
  for (let i=0;i<6;i++) f.tick(50);
  f.tick(1300,0);await settle();
  assert.equal(f.clips.length,2);assert.match(await f.clips[1].text(),/^header-1:/);
  f.capture.stop(true);await settle();
});

test("meeting capture stops the unused video track while retaining audio",async()=>{
  const f=fixture();await f.capture.start({source:"system"});
  const tracks=f.streams.flatMap(s=>s.getTracks());
  assert.ok(tracks.some(t=>t.kind==="video"&&t.stopped));
  assert.ok(tracks.some(t=>t.kind==="audio"&&!t.stopped));
  assert.equal(f.intervalMs,150);assert.equal(f.capture.samples.length,512);
  assert.equal(f.contexts[0].options.sampleRate,16000);
  assert.equal(f.recorders[0].options.audioBitsPerSecond,24000);
  assert.equal(f.recorders[0].timeslice,undefined);
  f.capture.stop(true);await settle();assert.ok(tracks.every(t=>t.stopped));
});

test("ten minutes of continuous speech stays clip-bounded with the lighter monitor",async()=>{
  const f=fixture();await f.capture.start();
  for(let elapsed=0;elapsed<600000;elapsed+=150){f.tick(150);await settle();}
  assert.ok(f.clips.length>=20&&f.clips.length<=22);
  assert.ok(f.recorders.every(r=>r.options.audioBitsPerSecond===24000));
  f.capture.stop(true);await settle();assert.equal(f.capture.phase,"idle");assert.equal(f.capture.context,null);
});
test("silent clips are discarded instead of uploading them",async () => {
  const f=fixture();await f.capture.start();f.tick(29000,0);await settle();
  assert.equal(f.clips.length,0);assert.equal(f.recorders.length,2);
  f.capture.stop(true);await settle();
});
test("stop releases every audio and video track and blocks a restart until finalization",async () => {
  const f=fixture();await f.capture.start({source:"both"});
  f.capture.stop(true);assert.equal(f.capture.phase,"stopping");
  await f.capture.start();await settle();
  assert.equal(f.capture.phase,"idle");assert.equal(f.recorders.length,1);
  assert.ok(f.streams.every(s => s.getTracks().every(t => t.stopped)));
  assert.equal(f.clips.length,0);
});
test("both falls back to mic with an explicit notice when loopback has no audio",async () => {
  const f=fixture({systemAudio:false});await f.capture.start({source:"both"});
  assert.equal(f.capture.phase,"listening");assert.equal(f.notices.length,1);assert.match(f.notices[0],/microphone/);
  f.capture.stop(true);await settle();
});
test("system-only mode fails clearly instead of silently recording a different source",async () => {
  const f=fixture({systemAudio:false});await f.capture.start({source:"system"});
  assert.equal(f.capture.phase,"idle");assert.match(f.errors[0],/Meeting audio/);
  assert.ok(f.streams.every(s => s.getTracks().every(t => t.stopped)));
});
test("permission denial is actionable and leaves capture idle",async () => {
  const f=fixture({micError:true});await f.capture.start();
  assert.equal(f.capture.phase,"idle");assert.match(f.errors[0],/Microphone access was denied/);
});
test("cancelling a slow start cannot close a newer recording's audio context",async () => {
  const f=fixture({slowResume:true});const first=f.capture.start();await settle();
  f.capture.stop(true);await f.capture.start();
  f.contexts[0].resumeResolve();await first;
  assert.equal(f.capture.phase,"listening");assert.equal(f.contexts[1].closed,undefined);
  f.capture.stop(true);await settle();
});
