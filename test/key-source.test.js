"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {loadKeySource}=require("../lib/key-source");
const {ConfigStore}=require("../lib/config");
function directory(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"assistant-key-source-"));
  t.after(()=>{assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return root;
}
test("portable launch reads a user-owned key file and reloads changed keys without network calls",t=>{
  const root=directory(t);const file=path.join(root,".env");
  fs.writeFileSync(file,'GROQ_API_KEY="first-local-key"\nUNRELATED_VARIABLE=ignored\n');
  const source=loadKeySource({directories:[root],env:{GROQ_API_KEYS:"stale-key"}});
  assert.equal(source.env.GROQ_API_KEYS,"first-local-key");assert.equal(source.env.UNRELATED_VARIABLE,undefined);
  const store=new ConfigStore({env:source.env,keySource:source});
  store.saved={providers:{groq:{keys:["old-saved-key"]}}};
  assert.deepEqual(store.get().providers.groq.keys,["first-local-key"]);
  const view=store.public();assert.equal(view.providers.groq.keyCount,1);assert.equal(view.providers.groq.keySource,"file");
  assert.ok(!JSON.stringify(view).includes("first-local-key"));
  fs.writeFileSync(file,"GROQ_API_KEY=second-local-key\n");
  store.reloadKeys(loadKeySource({directories:[root],env:{}}));
  assert.deepEqual(store.get().providers.groq.keys,["second-local-key"]);
});
test("a missing key file preserves environment keys and saved keys for other providers",t=>{
  const root=directory(t);const source=loadKeySource({directories:[root],env:{GROQ_API_KEY:"environment-key"}});
  assert.equal(source.file,null);assert.equal(source.error,null);
  const store=new ConfigStore({env:source.env,keySource:source});store.saved={providers:{gemini:{keys:["saved-gemini"]}}};
  assert.deepEqual(store.get().providers.groq.keys,["environment-key"]);assert.deepEqual(store.get().providers.gemini.keys,["saved-gemini"]);
});
test("key file precedence is stable and an unreadable or oversized file reports a safe error",t=>{
  const first=directory(t),second=directory(t);
  fs.writeFileSync(path.join(first,".env"),"GROQ_API_KEY=preferred\n");fs.writeFileSync(path.join(second,".env"),"GROQ_API_KEY=ignored\n");
  assert.equal(loadKeySource({directories:[first,second],env:{}}).env.GROQ_API_KEYS,"preferred");
  fs.writeFileSync(path.join(first,".env"),"GROQ_API_KEY="+"x".repeat(70000));
  const source=loadKeySource({directories:[first],env:{}});assert.match(source.error,/could not be read/);assert.equal(source.file,null);assert.ok(!source.error.includes("xxxxx"));
});
