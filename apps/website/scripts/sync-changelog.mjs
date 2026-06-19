// Generates src/content/docs/changelog.md from the repo-root CHANGELOG.md so the
// website always ships the real changelog. Runs on `prebuild`. If the source file
// isn't present (e.g. an isolated deploy upload), it leaves the committed copy in
// place rather than failing the build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/docs/changelog.md', import.meta.url));

const frontmatter = `---
title: Changelog
description: Every notable change to crawlie — new checks, MCP improvements, and fixes, newest first.
section: Project
order: 9
---
`;

if (!existsSync(SRC)) {
  console.warn(`[sync-changelog] ${SRC} not found — keeping existing ${OUT}`);
  process.exit(0);
}

const raw = readFileSync(SRC, 'utf8');

// Drop the leading "# Changelog" heading and intro blurb; the docs layout renders
// its own title + lede. Start the body at the first "## [version]" section.
const start = raw.search(/^## /m);
const body = start === -1 ? raw : raw.slice(start);

writeFileSync(OUT, frontmatter + '\n' + body.trimStart());
console.log(`[sync-changelog] wrote ${OUT}`);
