# Releasing crawlie

Releases are fully automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).
Pushing a tag like `v0.1.0` will:

1. Create a draft GitHub Release for the tag.
2. Build the **`crawlie`** CLI + **`crawlie-mcp`** server for macOS (arm64/x64), Linux (x64) and Windows (x64) and attach them.
3. Build the **signed + notarized macOS desktop app** (universal `.dmg`) and attach it.
4. Publish the release.
5. Publish **`@spronta/crawlie`** to npm (the wrapper that downloads those binaries).

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
   - `npm i -g @spronta/crawlie` live on npm
   - signed `.dmg` + per-platform CLI binaries on the GitHub Release

## Notes

- Linux/Windows **desktop installers** aren't built yet (the CLI ships everywhere; the desktop app currently targets macOS). Add matrix entries to the `desktop` job to extend.
- The npm wrapper downloads binaries from the release matching its own version, so step 5 runs only after the binaries are attached (steps 2–4).
