---
title: Getting started
description: Install crawlie via npm and run your first technical-SEO and GEO audit in under a minute — from the CLI, an agent, or on demand with npx.
section: Guide
order: 1
---

## What is crawlie?

crawlie is a fast, free, open-source technical-SEO and **GEO** (Generative Engine
Optimization — AI-search readiness) crawler. It runs locally, ships a CLI and an MCP
server, and gives you plain-English fixes for every issue it finds.

One engine, many surfaces: a shared Rust core powers the CLI, the MCP server (for
agents), and a Tauri desktop app.

## Install

The CLI and MCP server ship together on npm. The right native binary installs
automatically — nothing to download or unblock.

```bash
npm i -g @spronta/crawlie
```

This puts two commands on your `PATH`:

- `crawlie` — the CLI
- `crawlie-mcp` — the MCP server for agents

No install needed at all? Run it on demand with `npx`:

```bash
npx -y -p @spronta/crawlie crawlie crawl https://your-site.com
```

### From source

Needs [Rust](https://rustup.rs). The desktop app additionally needs
[pnpm](https://pnpm.io) + Node.

```bash
git clone https://github.com/spronta/crawlie
cd crawlie
cargo build --release          # → target/release/crawlie and crawlie-mcp
cargo install --path crates/crawlie-cli
cargo install --path crates/crawlie-mcp
```

## Your first crawl

Crawl a whole site and print a readable report:

```bash
crawlie crawl https://your-site.com --format pretty
```

Every crawl returns two scores: a **Health** score (technical SEO) and a **GEO**
score (AI-search readiness). See [Scoring](/docs/scoring).

Audit a single page, or a specific list:

```bash
crawlie audit https://your-site.com/pricing
crawlie audit https://your-site.com/a https://your-site.com/b
```

Learn why any finding matters and how to fix it:

```bash
crawlie explain geo-not-answerable
```

## Where to go next

- [CLI reference](/docs/cli) — every command, flag, and output format.
- [MCP server](/docs/mcp) — let an AI agent run and act on audits.
- [Skills & plugin](/docs/skills-and-plugin) — one-step Claude Code setup.
- [What it checks](/docs/checks) — the full rule catalogue.
