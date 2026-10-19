"use strict";

// One worker on demand; release its WASM heap after a short idle period.
// Aborting a request terminates recognition, rather than only ignoring its result.
class OCRCache {
  constructor(createWorker, { idleMs=15000, schedule=setTimeout, unschedule=clearTimeout }={}) {
    Object.assign(this,{createWorker,idleMs,schedule,unschedule});
    this.lease=null;this.job=null;this.timer=null;
  }
  dispose(lease=this.lease) {
    if (!lease || lease.disposed) return;
    lease.disposed=true;
    if (this.lease===lease) {this.lease=null;this.unschedule(this.timer);this.timer=null;}
    lease.promise.then(worker=>worker.terminate()).catch(()=>{});
  }
  async recognize(buffer,signal) {
    signal?.throwIfAborted();
    if (this.job) throw new Error("Screen recognition is already running. Wait or cancel it first.");
    this.unschedule(this.timer);this.timer=null;
    const job={};this.job=job;
    const lease=this.lease || {disposed:false,promise:Promise.resolve().then(()=>this.createWorker())};
    this.lease=lease;
    let abort;
    const aborted=new Promise((_,reject)=>{
      abort=()=>{this.dispose(lease);reject(signal.reason || new Error("Screen recognition cancelled."));};
      signal?.addEventListener("abort",abort,{once:true});
      if (signal?.aborted) abort();
    });
    try {
      const work=lease.promise.then(worker=>{
        signal?.throwIfAborted();
        if (lease.disposed) throw new Error("Screen recognition cancelled.");
        return worker.recognize(buffer);
      });
      return await Promise.race([work,aborted]);
    } catch(error) {
      this.dispose(lease);throw error;
    } finally {
      signal?.removeEventListener("abort",abort);
      if (this.job===job) this.job=null;
      if (this.lease===lease && !lease.disposed) {
        this.timer=this.schedule(()=>this.dispose(lease),this.idleMs);
        this.timer?.unref?.();
      }
    }
  }
}
module.exports={OCRCache};
