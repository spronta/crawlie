---
title: Desktop app
description: Install the crawlie desktop app for macOS — a local, point-and-click GUI over the same Rust engine as the CLI. Download the signed installer, run a crawl, and read your audit with scores, issues, and fixes.
section: Guide
order: 4
---

The crawlie desktop app is a native macOS application — a point-and-click front
end over the **exact same engine** that powers the [CLI](/docs/cli) and the
[MCP server](/docs/mcp). It crawls your site, scores it, and explains every
issue in plain English. Everything runs locally on your machine; nothing is
uploaded anywhere.

## Download

<p>
  <a class="download-btn" href="https://github.com/spronta/crawlie/releases/latest" data-track="cta_download" data-track-location="docs-desktop">⬇&nbsp; Download crawlie for macOS</a>
</p>

A **universal** build (Apple Silicon + Intel), **signed and notarized by Apple**
— so it opens with no security warnings. You'll always get the newest version
from the [latest release](https://github.com/spronta/crawlie/releases/latest);
the file is named `crawlie_<version>_universal.dmg`.

> **Windows / Linux:** the desktop app is macOS-only for now. The CLI and MCP
> server run everywhere — see [Getting started](/docs/getting-started) to install
> the CLI with `npm i -g crawlie`.

## Install

1. Download the `.dmg` from the link above.
2. Open it, then drag **crawlie** into your **Applications** folder.
3. Launch it from Applications or Spotlight.

Because the app is signed and notarized, macOS opens it without the "unidentified
developer" prompt. (On older macOS releases, if Gatekeeper ever blocks it,
right-click the app and choose **Open** once.)

## Run your first crawl

1. Enter a URL — for example `https://example.com` — and press **Crawl**.
2. Watch live progress as pages are fetched and audited.
3. When it finishes, you get a full report:

- **Health** and **GEO** scores (0–100) at a glance — see [Scoring](/docs/scoring)
  for what they mean.
- **Top fixes** — the highest-impact problems to tackle first, each with a
  plain-English *why it matters* and *how to fix it*.
- **Issues** — every finding, grouped by rule and severity. See the full rule
  list in [What it checks](/docs/checks).
- **Pages** — a sortable table of every crawled URL with its status code, click
  depth, inlinks, and per-page SEO/GEO scores.

## Saved reports & history

Every crawl is saved locally, so you can revisit a report without re-crawling.
Open **Reports** to load a past crawl or delete old ones. As of v0.4.0 these are
kept in a single SQLite database in the app's data folder
(`~/Library/Application Support/com.spronta.crawlie`).

## Export a shareable report

From any report, **Export** writes a self-contained **HTML file** to your
Downloads folder. Open it in any browser or hand it to a client or teammate — no
crawlie install required to read it.

## Updates

The app keeps itself current. When a new version ships, a banner appears and can
**download, install, and restart in one click**. Under **Settings** you can:

- toggle **Check for updates on launch**,
- toggle **Install updates automatically**, and
- **Check now** at any time.

Updates are cryptographically signed, so the app only installs releases it can
verify.

## Uninstall

Drag **crawlie** from Applications to the Trash. To also remove your saved
reports and settings, delete the folder
`~/Library/Application Support/com.spronta.crawlie`.

## One engine, three surfaces

The desktop app, the [CLI](/docs/cli), and the [MCP server](/docs/mcp) all share
the same Rust core, so the audit is identical across them. Reach for the GUI when
you're exploring a site, the CLI when you're wiring crawls into
[CI](/docs/ci), and the MCP server when an agent is doing the work.
