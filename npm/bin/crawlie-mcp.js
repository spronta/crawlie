#!/usr/bin/env node
// Launcher → the native `crawlie-mcp` binary from the matching platform package.
const { spawnSync } = require("child_process");
const { binaryPath } = require("../resolve.js");

let bin;
try {
  bin = binaryPath("crawlie-mcp");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
