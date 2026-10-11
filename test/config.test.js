"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {randomBytes,createCipheriv,createDecipheriv}=require("node:crypto");
const {ConfigStore,validateBaseURL}=require("../lib/config");
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"assistant-config-test-"));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const key=randomBytes(32);
  const encryption={isEncryptionAvailable:() => true,
    encryptString:s => {const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key,iv);return Buffer.concat([iv,cipher.update(s,"utf8"),cipher.final(),cipher.getAuthTag()]);},
    decryptString:buf => {const decipher=createDecipheriv("aes-256-gcm",key,buf.subarray(0,12));decipher.setAuthTag(buf.subarray(-16));return Buffer.concat([decipher.update(buf.subarray(12,-16)),decipher.final()]).toString("utf8");},
  };
  return {directory,encryption,env:{GROQ_API_KEY:"environment-key"}};
}
test("encrypted settings round-trip without leaking keys through public settings",t => {
  const opts=fixture(t);const store=new ConfigStore(opts);
  const view=store.save({providers:{groq:{keys:"new-private-key,backup-key"}}});
  assert.equal(view.providers.groq.keyCount,2);assert.ok(!JSON.stringify(view).includes("new-private-key"));
  assert.ok(!fs.readFileSync(store.file).toString().includes("new-private-key"));
  const reload=new ConfigStore(opts);assert.deepEqual(reload.get().providers.groq.keys,["new-private-key","backup-key"]);
});
test("blank key input keeps saved keys and explicit clearing overrides an environment key",t => {
  const store=new ConfigStore(fixture(t));
  store.save({providers:{groq:{keys:"replacement"}}});
  store.save({providers:{groq:{keys:""}}});assert.deepEqual(store.get().providers.groq.keys,["replacement"]);
  store.save({providers:{groq:{clearKeys:true}}});assert.deepEqual(store.get().providers.groq.keys,[]);
});
test("corrupt encrypted storage remains recoverable from environment configuration",t => {
  const opts=fixture(t);fs.writeFileSync(path.join(opts.directory,"provider-settings.enc"),"broken");
  const store=new ConfigStore(opts);assert.match(store.public().loadError,/unlocked/);
  assert.deepEqual(store.get().providers.groq.keys,["environment-key"]);
  store.save({providers:{groq:{keys:"repaired"}}});assert.equal(store.public().loadError,null);
});
test("unavailable encryption never writes keys in plaintext",t => {
  const opts=fixture(t);opts.encryption.isEncryptionAvailable=() => false;
  const store=new ConfigStore(opts);assert.throws(() => store.save({providers:{groq:{keys:"secret"}}}),/Encrypted/);
  assert.equal(fs.existsSync(store.file),false);
});
test("invalid settings cannot partially overwrite a valid configuration",t => {
  const store=new ConfigStore(fixture(t));store.save({providers:{groq:{keys:"working"}}});
  assert.throws(() => store.save({providers:{groq:{keys:"replacement"},invalid:{keys:"oops"}}}),/Unknown/);
  assert.deepEqual(store.get().providers.groq.keys,["working"]);
});
test("API base URLs reject insecure remote HTTP, credentials and query strings",() => {
  assert.equal(validateBaseURL("https://api.example.com/v1/"),"https://api.example.com/v1");
  assert.equal(validateBaseURL("http://localhost:11434/v1"),"http://localhost:11434/v1");
  for (const url of ["http://api.example.com","https://name:pass@example.com","https://example.com?key=secret","file:///secret"]) assert.throws(() => validateBaseURL(url));
});
