// Resolve the native binary for the current platform from the matching
// optional dependency package. No downloads, no postinstall — npm installs only
// the platform package that matches `os`/`cpu`.

const fs = require("fs");
const path = require("path");

const PKG = {
  "darwin-arm64": "@spronta/crawlie-darwin-arm64",
  "darwin-x64": "@spronta/crawlie-darwin-x64",
  "linux-x64": "@spronta/crawlie-linux-x64",
  "win32-x64": "@spronta/crawlie-win32-x64",
};

/** Absolute path to a bundled binary (`crawlie` or `crawlie-mcp`). */
function binaryPath(name) {
  const key = `${process.platform}-${process.arch}`;
  const pkg = PKG[key];
  if (!pkg) {
    throw new Error(
      `crawlie: no prebuilt binary for ${key}. Build from source: https://github.com/spronta/crawlie`
    );
  }
  let dir;
  try {
    dir = path.dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    throw new Error(
      `crawlie: the platform package ${pkg} isn't installed. Reinstall @spronta/crawlie, ` +
        `or build from source: https://github.com/spronta/crawlie`
    );
  }
  const ext = process.platform === "win32" ? ".exe" : "";
  const bin = path.join(dir, `${name}${ext}`);
  if (!fs.existsSync(bin)) {
    throw new Error(`crawlie: binary not found at ${bin}.`);
  }
  return bin;
}

module.exports = { binaryPath };
