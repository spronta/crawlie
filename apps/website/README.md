# crawlie.dev — website + docs

The marketing landing page (`/`) and documentation (`/docs`) for crawlie, built with
[Astro](https://astro.build). Dark, Geist-styled, zero client JS beyond a copy button.

## Develop

```bash
pnpm install        # from repo root, or: cd apps/website && pnpm install
pnpm --filter crawlie-website dev    # or: cd apps/website && pnpm dev
```

- Landing page: `src/pages/index.astro`
- Docs are Markdown in `src/content/docs/*.md` (frontmatter: `title`, `description`,
  `section`, `order`). Add a file → it appears in the sidebar automatically.
- Design tokens: `src/styles/global.css`.
- OG image: `public/og.png`, regenerate from `scripts/og.svg` with
  `rsvg-convert -w 1200 -h 630 scripts/og.svg -o public/og.png`.

## Deploy (Vercel)

Static output — no adapter needed. Point a Vercel project at this directory
(`apps/website`); Astro is auto-detected.

**Domains:** add all three to the same project. `crawlie.dev` is canonical;
`crawlie.app` and `crawlie.co` 301-redirect to it via `vercel.json` (host-based
redirects). You can also set the redirect at the domain level in the Vercel dashboard.

| Domain | Role |
|---|---|
| `crawlie.dev` | Canonical — landing + docs |
| `crawlie.app` | Redirects → crawlie.dev |
| `crawlie.co` | Redirects → crawlie.dev |
