"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createServer}=require("../server");
async function fixture(t,options) {
  const server=createServer(options);await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test("local API rejects unauthorized requests and does not expose permissive CORS",async t => {
  let calls=0;const base=await fixture(t,{token:"test-token",ai:{answer:async () => {calls++;return {answer:"OK"};}}});
  const res=await fetch(`${base}/api/ask`,{method:"POST",body:'{"question":"Hi"}'});
  assert.equal(res.status,401);assert.equal(res.headers.get("access-control-allow-origin"),null);assert.equal(calls,0);
});
test("authenticated requests share the actual answer service",async t => {
  const base=await fixture(t,{token:"test-token",ai:{answer:async q => ({answer:q})}});
  const res=await fetch(`${base}/api/ask`,{method:"POST",headers:{Authorization:"Bearer test-token"},body:'{"question":"Hello"}'});
  assert.equal(res.status,200);assert.equal((await res.json()).answer,"Hello");
});
test("missing server token fails closed while health remains available",async t => {
  const base=await fixture(t,{token:""});
  assert.equal((await fetch(`${base}/health`)).status,200);
  assert.equal((await fetch(`${base}/api/ask`,{method:"POST"})).status,503);
});
test("malformed JSON and oversized input produce clear client errors",async t => {
  const base=await fixture(t,{token:"test-token",ai:{answer:async () => ({answer:"OK"})}});
  const options={method:"POST",headers:{Authorization:"Bearer test-token"}};
  assert.equal((await fetch(`${base}/api/ask`,{...options,body:"{"})).status,400);
  assert.equal((await fetch(`${base}/api/ask`,{...options,body:"a".repeat(66000)})).status,413);
});
