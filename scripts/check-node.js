"use strict";

function isSupported(version) {
  const parts = String(version).replace(/^v/, "").split(".").map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0)) return false;
  const [major, minor] = parts;
  return major > 22 || (major === 22 && minor >= 12);
}

function checkNode(version = process.versions.node) {
  if (isSupported(version)) return true;
  console.error([
    "",
    `Cannot build or develop Stealth Overlay with Node ${version}.`,
    "The Electron build tools require Node 22.12 or newer. Install Node 24 LTS from https://nodejs.org/.",
    "Close and reopen your terminal after installing, then run: npm ci && npm run build",
    "To use the app without Node, double-click the prebuilt Stealth Overlay.exe instead.",
    "",
  ].join("\n"));
  return false;
}

module.exports = { isSupported, checkNode };
if (require.main === module && !checkNode()) process.exitCode = 1;
