"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {parse}=require("dotenv");
const {DEFAULT_ORDER,list}=require("./providers");

// Read user-owned keys locally. Never fetch credentials from public websites,
// bundle a user's .env, or return any key value to the renderer.
function loadKeySource({directories=[],env=process.env}={}) {
  const config={...env};
  const sources={};
  let file=null,error=null;
  for (const directory of [...new Set(directories.filter(Boolean))]) {
    const candidate=path.join(directory,".env");
    try {
      if (!fs.existsSync(candidate)) continue;
      if (fs.statSync(candidate).size>65536) throw new Error("oversized");
      const parsed=parse(fs.readFileSync(candidate));
      // Only recognized configuration names enter the app environment.
      for (const [name,value] of Object.entries(parsed)) {
        if (/^(GROQ|OPENAI|GEMINI|OPENROUTER)_(API_KEY|API_KEYS|BASE_URL|TEXT_MODELS|VISION_MODELS|TRANSCRIPTION_MODELS)$|^AI_(PROVIDER_ORDER|TIMEOUT_MS|BUDGET_MS|MAX_ATTEMPTS)$/.test(name)) config[name]=value;
      }
      for (const id of DEFAULT_ORDER) {
        const prefix=id.toUpperCase();
        const keys=list(parsed[`${prefix}_API_KEYS`]||parsed[`${prefix}_API_KEY`]);
        if(keys.length) {
          // A fresh single key must also replace an older plural environment value.
          config[`${prefix}_API_KEYS`]=keys.join(",");
          sources[id]="file";
        }
      }
      file=candidate;break;
    } catch {
      error="The local .env key file could not be read. Check its permissions and keep it under 64 KB.";
      break;
    }
  }
  return {env:config,sources,file,error};
}
module.exports={loadKeySource};
