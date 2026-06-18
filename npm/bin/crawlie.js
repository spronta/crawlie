#!/usr/bin/env node
// Thin launcher → the native `crawlie` binary fetched by install.js.
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const bin = path.join(__dirname, `crawlie${process.platform === "win32" ? ".exe" : ""}`);
if (!fs.existsSync(bin)) {
  console.error("[crawlie] binary not found — reinstall @spronta/crawlie, or build from https://github.com/spronta/crawlie");
  process.exit(1);
}
const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
