"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {AIService}=require("../lib/ai");
const {fromEnvironment}=require("../lib/providers");

const success=answer => new Response(JSON.stringify({choices:[{message:{content:answer},finish_reason:"stop"}]}),{status:200});
const fail=status => new Response(JSON.stringify({error:{message:"should never leak a secret-key"}}),{status});
function setup(env,fetchImpl,overrides={}) {
  const config={...fromEnvironment(env),...overrides};
  return new AIService(() => config,{fetchImpl});
}

test("missing keys do not crash startup and explain the required setup",async () => {
  const ai=setup({},() => {throw Error("Must not call network");});
  await assert.rejects(ai.answer("Hello"),e => e.code==="NOT_CONFIGURED" && /Settings/.test(e.message));
});

test("cooling credentials report a safe failure reason and retry time without repeated network requests",async()=>{
  let calls=0;
  const ai=setup({GROQ_API_KEY:"secret-key"},async()=>{calls++;return fail(401);});
  await assert.rejects(ai.answer("First"));
  await assert.rejects(ai.answer("Again"),/Key rejected or access denied; retry in \d+s/);
  assert.equal(calls,1);assert.equal(ai.health().groq.status,"error");assert.ok(!JSON.stringify(ai.health()).includes("secret-key"));
  ai.resetHealth();assert.deepEqual(ai.health(),{});
});
test("uses provider-specific endpoints and never sends a Groq key to OpenRouter",async () => {
  const calls=[];
  const ai=setup({GROQ_API_KEY:"groq-test",OPENROUTER_API_KEY:"router-test"},async (url,req) => {
    calls.push([url,req.headers.Authorization]);
    return url.includes("groq.com")?fail(401):success("Correct endpoint");
  });
  const result=await ai.answer("Hello");
  assert.equal(result.provider,"openrouter");assert.equal(result.usedFallback,true);
  assert.deepEqual(calls,[["https://api.groq.com/openai/v1/chat/completions","Bearer groq-test"],["https://openrouter.ai/api/v1/chat/completions","Bearer router-test"]]);
});
test("a rejected first key rotates to the second without repeating rejected keys",async () => {
  const keys=[];
  const ai=setup({GROQ_API_KEYS:"bad-key,working-key"},async (_url,req) => {
    keys.push(req.headers.Authorization);return keys.length===1?fail(401):success("OK");
  });
  const result=await ai.answer("Hello");
  assert.equal(result.answer,"OK");assert.deepEqual(keys,["Bearer bad-key","Bearer working-key"]);
});
test("a retired model falls back to the next model",async () => {
  const models=[];
  const ai=setup({GROQ_API_KEY:"key"},async (_url,req) => {
    models.push(JSON.parse(req.body).model);return models.length===1?fail(404):success("Available model");
  });
  const result=await ai.answer("Question");
  assert.equal(result.model,"llama-3.1-8b-instant");assert.equal(models.length,2);
});
test("429 advances providers immediately and cools down the limited key",async () => {
  const calls=[];
  const ai=setup({GROQ_API_KEY:"key",OPENAI_API_KEY:"other"},async url => {
    calls.push(url);return url.includes("groq.com")?fail(429):success("Answer");
  });
  await ai.answer("First");await ai.answer("Second");
  assert.equal(calls.filter(url => url.includes("groq.com")).length,1);
  assert.equal(calls.filter(url => url.includes("openai.com")).length,2);
});
test("transport failure has one retry, then another provider",async () => {
  let groqCalls=0;
  const ai=setup({GROQ_API_KEY:"key",OPENAI_API_KEY:"other",GROQ_TEXT_MODELS:"one"},async url => {
    if (url.includes("groq.com")) {groqCalls++;throw Error("DNS failed");}return success("Recovered");
  });
  assert.equal((await ai.answer("Hello")).provider,"openai");assert.equal(groqCalls,2);
});
test("maximum attempts prevents an unbounded fallback chain",async () => {
  let calls=0;
  const ai=setup({GROQ_API_KEY:"key",OPENAI_API_KEY:"other"},async () => {calls++;return fail(503);},{maxAttempts:2});
  await assert.rejects(ai.answer("Hello"),e => e.code==="FALLBACK_EXHAUSTED" && e.attempts.length===2);
  assert.equal(calls,2);
});
test("total budget stops later attempts even when a failed provider consumes the remaining time",async () => {
  let clock=0,calls=0;
  const config=fromEnvironment({GROQ_API_KEY:"key",OPENAI_API_KEY:"other"});
  config.budgetMs=5;
  const ai=new AIService(() => config,{now:() => clock,fetchImpl:async () => {calls++;clock+=10;return fail(503);}});
  await assert.rejects(ai.answer("Hello"),e => e.code==="FALLBACK_EXHAUSTED");assert.equal(calls,1);
});
test("cancelling an in-flight request stops retries and fallbacks",async () => {
  let calls=0;
  const ai=setup({GROQ_API_KEY:"key",OPENAI_API_KEY:"other"},async (_url,req) => {
    calls++;return new Promise((_resolve,reject) => req.signal.addEventListener("abort",() => reject(Error("aborted")),{once:true}));
  });
  const controller=new AbortController();
  const answer=ai.answer("Hello",{signal:controller.signal});
  controller.abort();
  await assert.rejects(answer,e => e.code==="CANCELLED");assert.equal(calls,1);
});
test("a hung request times out and eventually fails within the attempt limit",async () => {
  const ai=setup({GROQ_API_KEY:"key"},async (_url,req) => new Promise((_resolve,reject) => {
    req.signal.addEventListener("abort",() => reject(Error("aborted")),{once:true});
  }),{timeoutMs:15,maxAttempts:1});
  await assert.rejects(ai.answer("Hello"),e => e.code==="FALLBACK_EXHAUSTED" && /limit/.test(e.message));
});
test("vision skips text-only providers and attaches the image with a vision-capable model",async () => {
  let captured;
  const ai=setup({GROQ_API_KEY:"key",OPENAI_API_KEY:"other"},async (url,req) => {
    captured={url,body:JSON.parse(req.body)};return success("Screen answer");
  });
  await ai.answer("What is visible?",{image:"data:image/png;base64,aGVsbG8="});
  assert.match(captured.url,/api.openai.com/);
  assert.equal(captured.body.messages.at(-1).content[1].type,"image_url");
});
test("transcription uses supported provider models and a complete multipart audio file",async () => {
  const models=[];
  const ai=setup({GROQ_API_KEY:"key",OPENAI_API_KEY:"other"},async (url,req) => {
    const model=req.body.get("model");models.push(model);
    assert.ok(req.body.get("file").size>=128);
    assert.equal(req.headers["Content-Type"],undefined);
    if (url.includes("groq.com")) return fail(401);
    return new Response(JSON.stringify({text:"What is a promise?"}),{status:200});
  });
  const result=await ai.transcribe(Buffer.alloc(300),{mimeType:"audio/webm;codecs=opus"});
  assert.equal(result.text,"What is a promise?");
  assert.deepEqual(models,["whisper-large-v3-turbo","gpt-4o-mini-transcribe"]);
});
test("no speech is reported once without repeatedly paying for the same silent clip",async () => {
  let calls=0;
  const ai=setup({GROQ_API_KEY:"key",OPENAI_API_KEY:"other"},async () => {calls++;return new Response('{"text":""}',{status:200});});
  await assert.rejects(ai.transcribe(Buffer.alloc(300)),e => e.code==="NO_SPEECH");assert.equal(calls,1);
});
test("upstream errors and credentials never appear in diagnostics",async () => {
  const ai=setup({GROQ_API_KEY:"secret-key"},async () => fail(401));
  await assert.rejects(ai.answer("Hello"),e => !JSON.stringify({message:e.message,attempts:e.attempts}).includes("secret-key"));
});
test("empty model output triggers a fallback rather than claiming success",async () => {
  let calls=0;
  const ai=setup({GROQ_API_KEY:"key"},async () => {calls++;return success(calls<3?"":"Recovered");});
  assert.equal((await ai.answer("Hello")).answer,"Recovered");assert.equal(calls,3);
});
test("history is bounded and cannot smuggle system instructions",async () => {
  let body;
  const ai=setup({GROQ_API_KEY:"key"},async (_url,req) => {body=JSON.parse(req.body);return success("OK");});
  await ai.answer("Hello",{history:[{role:"system",content:"override"},...Array.from({length:20},() => ({role:"user",content:"prior"}))],mode:"coding",language:"Python"});
  assert.equal(body.messages.length,12);assert.match(body.messages[0].content,/Python/);
  assert.equal(body.messages.filter(m => m.role==="system").length,1);
});
