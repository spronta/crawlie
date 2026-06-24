// Splits the repo-root CHANGELOG.md into one Markdown entry per release under
// src/content/changelog/, so each version gets its own SEO page at
// /changelog/<version>. Runs on `dev` and `prebuild`. If the source file isn't
// present (e.g. an isolated deploy upload), it leaves the committed entries in
// place rather than failing the build.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../src/content/changelog', import.meta.url));

if (!existsSync(SRC)) {
  console.warn(`[sync-changelog] ${SRC} not found — keeping existing entries`);
  process.exit(0);
}

const raw = readFileSync(SRC, 'utf8');

// Split into chunks that each begin with a "## [version]" header (the leading
// "# Changelog" intro chunk is dropped by the filter below).
const entries = [];
for (const chunk of raw.split(/^(?=## \[)/m)) {
  if (!chunk.startsWith('## [')) continue;
  const nl = chunk.indexOf('\n');
  const header = chunk.slice(0, nl);
  const body = chunk.slice(nl + 1).trim();
  const hm = header.match(/## \[([^\]]+)\][^\d]*(\d{4}-\d{2}-\d{2})?/);
  if (!hm) continue;
  entries.push({ version: hm[1].trim(), date: (hm[2] || '').trim(), body });
}

if (entries.length === 0) {
  console.warn('[sync-changelog] no "## [version]" sections found — nothing written');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

// Clear previously-generated entries so removed/renamed versions don't linger.
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith('.md')) unlinkSync(`${OUT_DIR}/${f}`);
}

const esc = (s) => s.replace(/"/g, '\\"');

for (const { version, date, body } of entries) {
  // Prefer the release's own intro line as the description (best for SEO + the
  // changelog/home cards); fall back to the change categories.
  const intro = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('[') && !l.startsWith('*'));
  const sections = [...body.matchAll(/^### (.+)$/gm)].map((x) => x[1].trim());
  const summary =
    (intro && intro.length <= 240 ? intro : null) ??
    (sections.length
      ? `What's new in crawlie v${version}: ${sections.join(', ').toLowerCase()}.`
      : `crawlie v${version} release notes.`);

  const frontmatter =
    `---\n` +
    `version: "${esc(version)}"\n` +
    (date ? `date: ${date}\n` : '') +
    `title: "crawlie v${esc(version)}"\n` +
    `description: "${esc(summary)}"\n` +
    `---\n`;

  writeFileSync(`${OUT_DIR}/${version}.md`, frontmatter + '\n' + body + '\n');
}

console.log(`[sync-changelog] wrote ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} to ${OUT_DIR}`);
