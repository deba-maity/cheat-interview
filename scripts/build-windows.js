"use strict";

// Check before loading electron-builder: old Node versions otherwise crash
// inside its ESM downloader with ERR_REQUIRE_ESM and no useful next step.
const { checkNode } = require("./check-node");
if (!checkNode()) process.exit(1);

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");

if (process.platform !== "win32") {
  console.error("Build this Windows distribution on Windows. The prebuilt .exe does not require Node on its destination computer.");
  process.exit(1);
}

let cli;
try {
  cli = require.resolve("electron-builder/cli.js");
} catch {
  console.error("Build dependencies are missing. Run npm ci with Node 24 LTS, then run npm run build again.");
  process.exit(1);
}

const child = spawn(process.execPath, [cli, "--win", "nsis", "portable", "--x64", "--publish", "never"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => {
  if (code !== 0 || signal) {
    console.error("Build did not finish. No new root executable was copied. An existing executable, if present, is from a previous build.");
    process.exitCode = code || 1;
    return;
  }
  try {
    const source = path.join(root, "dist", "Stealth Overlay.exe");
    if (!fs.statSync(source).isFile()) throw new Error("Portable executable was not produced.");
    const destination = path.join(root, "Stealth Overlay.exe");
    fs.copyFileSync(source, destination);
    console.log(`\nReady to double-click: ${destination}`);
    console.log("Copy this single portable .exe to your Windows laptop. Node and VS Code are not needed to run it.");
    console.log("The installer is also available in dist/. Generated executables are not transferred by git pull.");
  } catch (error) {
    console.error(`Packaging finished, but copying the portable app failed: ${error.message}`);
    process.exitCode = 1;
  }
});
