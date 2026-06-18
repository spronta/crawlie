# Releasing crawlie

Releases are fully automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).
Pushing a tag like `v0.1.0` will, in two independent tracks:

**npm (the CLI + MCP):**
1. Build `crawlie` + `crawlie-mcp` for macOS (arm64/x64), Linux (x64), Windows (x64) and publish a platform package each (`@spronta/crawlie-darwin-arm64`, …) containing the native binaries.
2. Publish the main **`@spronta/crawlie`** wrapper, which pulls in the one matching platform package via `optionalDependencies` (no install-time download, no Gatekeeper prompt).

**GitHub Release (the desktop app — the only thing to download):**
3. Build the **signed + notarized universal macOS `.dmg`** and attach it to the release, then publish the release.

> The two tracks are independent: **npm publishes even if the signed desktop build fails** (e.g. an Apple secret is missing). The CLI never blocks on signing.

## One-time setup — repository secrets

Add these under **Settings → Secrets and variables → Actions**.

### npm
| Secret | Value |
|---|---|
| `NPM_TOKEN` | An **Automation** access token for the Spronta npm account (must be able to publish `@spronta/*`). |

### Apple code signing & notarization
Using the Spronta Apple Developer account:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Base64 of your **Developer ID Application** certificate `.p12`: `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12`. |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Spronta Ltd (TEAMID)` (exact string from Keychain). |
| `APPLE_ID` | The Apple ID email used for notarization. |
| `APPLE_PASSWORD` | An **app-specific password** for that Apple ID (appleid.apple.com → Sign-In and Security). |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID. |

> The `GITHUB_TOKEN` used to upload assets is provided automatically by Actions — no setup needed.

### Exporting the signing certificate

1. In **Keychain Access**, find your *Developer ID Application: Spronta…* certificate.
2. Right-click → **Export** → `.p12`, set a password (→ `APPLE_CERTIFICATE_PASSWORD`).
3. `base64 -i Certificates.p12 | pbcopy` → paste into `APPLE_CERTIFICATE`.

## Cutting a release

1. Bump versions so they all match the tag:
   - root `Cargo.toml` → `[workspace.package].version`
   - `apps/desktop/src-tauri/tauri.conf.json` → `version`
   - `apps/desktop/package.json` → `version`
   - (the npm package version is set automatically from the tag)
2. Commit, then tag and push:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. Watch the **Release** workflow. When it finishes you'll have:
   - `npm i -g @spronta/crawlie` live on npm (5 packages: the wrapper + 4 platform packages)
   - a signed `.dmg` on the GitHub Release

> The main wrapper pins its `optionalDependencies` to the exact release version, so all five npm packages always match the tag.

## Notes

- The **CLI/MCP are npm-only** — no loose binaries on the Releases page (that's what avoids the macOS Gatekeeper prompt). The only release download is the desktop `.dmg`.
- Linux/Windows **desktop installers** aren't built yet (the CLI ships everywhere via npm; the desktop app currently targets macOS). Add matrix entries to the `desktop` job to extend.
- First publish: the `@spronta` scope must exist on npm and `NPM_TOKEN` must be allowed to create new `@spronta/*` packages (the 4 platform packages are created on the first release).
