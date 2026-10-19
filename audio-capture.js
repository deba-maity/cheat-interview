"use strict";

// Each utterance is a new MediaRecorder session so every upload has its own
// WebM header. A timeslice blob alone is NOT an independently playable file.
class AudioCapture {
  constructor({onClip,onLevel,onState,onNotice,onError}) {
    Object.assign(this,{onClip,onLevel,onState,onNotice,onError});
    this.phase="idle";
    this.generation=0;
    this.streams=[];
  }

  async start({source="microphone",deviceId=""}={}) {
    if (this.phase!=="idle") return;
    const generation=++this.generation;
    this.phase="starting"; this.onState?.("starting");
    const streams=[];
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder==="undefined") throw new Error("Audio capture is unavailable in this runtime.");
      if (source!=="microphone") {
        try {
          const system=await navigator.mediaDevices.getDisplayMedia({
            video:{frameRate:1,width:16,height:16},
            audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},
          });
          if (!system.getAudioTracks().length) {
            system.getTracks().forEach(track => track.stop());
            throw new Error("The selected display did not provide system audio.");
          }
          // Meeting mode only consumes audio. Do not keep capturing desktop
          // frames throughout the call just to satisfy getDisplayMedia setup.
          system.getTracks().filter(track => track.kind==="video").forEach(track => track.stop());
          streams.push(system);
        } catch (error) {
          if (source==="system") throw new Error("Meeting audio could not be captured. On Windows, check that the meeting is playing sound. Try Microphone or Both as an alternative.");
          this.onNotice?.("Meeting audio is unavailable; using the microphone instead.");
        }
      }
      if (source!=="system") {
        try {
          streams.push(await navigator.mediaDevices.getUserMedia({audio:{
            ...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true,
          },video:false}));
        } catch (error) {
          if (!streams.length) throw new Error(error.name==="NotAllowedError"
            ? "Microphone access was denied. Enable it in Windows Settings → Privacy & security → Microphone."
            : "Microphone could not be opened. Check the selected device and try again.");
          this.onNotice?.("Microphone is unavailable; capturing meeting audio only.");
        }
      }
      if (generation!==this.generation) {streams.forEach(s => s.getTracks().forEach(t => t.stop())); return;}
      this.streams=streams;
      const AudioContextClass=window.AudioContext || window.webkitAudioContext;
      const context=new AudioContextClass({sampleRate:16000,latencyHint:"playback"});
      this.context=context;
      await context.resume();
      if (generation!==this.generation) {
        streams.forEach(s => s.getTracks().forEach(t => t.stop()));
        if (this.context===context) this.release();
        else context.close().catch(() => {});
        return;
      }
      this.destination=this.context.createMediaStreamDestination();
      this.analyser=this.context.createAnalyser();
      this.analyser.fftSize=512;
      this.samples=new Float32Array(this.analyser.fftSize);
      this.sources=streams.map(stream => {
        const input=this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        input.connect(this.destination); input.connect(this.analyser); return input;
      });
      for (const stream of streams) {
        for (const track of stream.getAudioTracks()) track.onended=() => {
          if (this.phase==="listening") {this.onError?.("An audio source disconnected. Choose another device and start again.");this.stop(true);}
        };
      }
      const supported=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"];
      this.mimeType=supported.find(type => MediaRecorder.isTypeSupported(type)) || "";
      this.phase="listening"; this.onState?.("listening");
      this.startClip();
      this.timer=setInterval(() => this.monitor(),150);
    } catch (error) {
      streams.forEach(s => s.getTracks().forEach(t => t.stop()));
      if (generation===this.generation) {
        this.phase="idle";this.release();this.onState?.("idle");this.onError?.(error.message);
      }
    }
  }

  startClip() {
    if (this.phase!=="listening") return;
    this.clipStarted=performance.now();
    this.lastSpeech=0;this.speechMs=0;this.lastTick=this.clipStarted;
    this.chunks=[];this.discardCurrent=false;
    const recorder=new MediaRecorder(this.destination.stream,this.mimeType?{mimeType:this.mimeType,audioBitsPerSecond:24000}:{});
    this.recorder=recorder;
    recorder.ondataavailable=event => {if (event.data.size) this.chunks.push(event.data);};
    recorder.onerror=() => {this.onError?.("Audio encoder failed. Stop and select another input device.");this.stop(true);};
    recorder.onstop=() => {
      const blob=new Blob(this.chunks,{type:recorder.mimeType || "audio/webm"});
      const valid=this.speechMs>=250 && !this.discardCurrent && blob.size>=128;
      this.recorder=null;
      if (this.phase==="listening") this.startClip();
      else {this.release();this.phase="idle";this.onState?.("idle");}
      if (valid) this.onClip?.(blob);
    };
    // A clip is capped at 28 seconds; collect one encoded blob instead of
    // allocating new chunks and dispatching events four times every second.
    recorder.start();
  }

  monitor() {
    if (this.phase!=="listening" || !this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    let total=0;
    for (let i=0;i<this.samples.length;i++) total+=this.samples[i]*this.samples[i];
    const rms=Math.sqrt(total/this.samples.length);
    this.onLevel?.(Math.min(1,rms*8));
    const now=performance.now();
    if (rms>.009) {this.lastSpeech=now;this.speechMs+=Math.min(250,now-this.lastTick);}
    this.lastTick=now;
    const silence=this.lastSpeech && now-this.lastSpeech>1200 && this.speechMs>=250;
    if ((silence || now-this.clipStarted>=28000) && this.recorder?.state==="recording") this.recorder.stop();
  }

  stop(discard=false) {
    ++this.generation;
    this.phase=this.recorder?"stopping":"idle";
    clearInterval(this.timer);this.timer=null;
    this.discardCurrent=discard;
    this.onLevel?.(0);this.onState?.(this.phase);
    if (this.recorder?.state==="recording") this.recorder.stop();
    else if (!this.recorder) this.release();
  }

  release() {
    this.streams.forEach(s => s.getTracks().forEach(t => {t.onended=null;t.stop();}));
    this.streams=[];
    this.destination?.stream.getTracks().forEach(t => t.stop());
    this.sources?.forEach(s => s.disconnect());
    this.sources=[];
    this.context?.close().catch(() => {});
    this.context=null;this.destination=null;this.analyser=null;
  }
}
window.AudioCapture=AudioCapture;
