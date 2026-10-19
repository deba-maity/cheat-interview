"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkNode, isSupported } = require("../scripts/check-node");

test("build rejects the reported laptop runtime and accepts the supported boundary", () => {
  for (const version of ["20.13.1", "20.19.0", "22.11.0", "bad", "22.12", "22.12.-1"]) assert.equal(isSupported(version), false, version);
  for (const version of ["22.12.0", "22.13.0", "24.0.0", "24.18.0"]) assert.equal(isSupported(version), true, version);
});

test("unsupported Node produces an actionable message without loading the builder", t => {
  const messages = [];
  t.mock.method(console, "error", message => messages.push(message));
  assert.equal(checkNode("20.13.1"), false);
  assert.match(messages.join("\n"), /Node 24 LTS/);
  assert.match(messages.join("\n"), /Stealth Overlay\.exe/);
  assert.equal(checkNode("24.18.0"), true);
});
