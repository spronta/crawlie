// Postinstall: download the prebuilt `crawlie` + `crawlie-mcp` binaries that
// match this package version and the host platform, from the matching GitHub
// release. Soft-fails (exit 0) so a missing platform never breaks `npm install`.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { version } = require("./package.json");

const REPO = "spronta/crawlie";
const ext = process.platform === "win32" ? ".exe" : "";
const target = `${process.platform}-${process.arch}`; // e.g. darwin-arm64

const SUPPORTED = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]);
if (!SUPPORTED.has(target)) {
  console.error(`[crawlie] no prebuilt binary for ${target}.`);
  console.error(`[crawlie] build from source: https://github.com/${REPO}`);
  process.exit(0);
}

const binDir = path.join(__dirname, "bin");
fs.mkdirSync(binDir, { recursive: true });

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "crawlie-installer" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects > 5) return reject(new Error("too many redirects"));
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function fetchBinary(name) {
  const asset = `${name}-${target}${ext}`;
  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
  const dest = path.join(binDir, `${name}${ext}`);
  process.stdout.write(`[crawlie] downloading ${asset}\n`);
  await download(url, dest);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
}

(async () => {
  try {
    await fetchBinary("crawlie");
    await fetchBinary("crawlie-mcp");
    console.log("[crawlie] installed — run `crawlie --help` or `crawlie-mcp` for agents.");
  } catch (err) {
    console.error(`[crawlie] install failed: ${err.message}`);
    console.error(`[crawlie] you can build from source: https://github.com/${REPO}`);
    process.exit(0);
  }
})();
