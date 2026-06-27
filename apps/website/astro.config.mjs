import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build
export default defineConfig({
  site: 'https://crawlie.dev',
  integrations: [sitemap()],
  redirects: {
    '/docs': '/docs/getting-started',
    '/docs/changelog': '/changelog',
  },
  markdown: {
    shikiConfig: {
      // Dual themes emitted as CSS variables so code blocks follow light/dark.
      themes: { light: 'github-light', dark: 'github-dark-default' },
      defaultColor: false,
      wrap: false,
    },
  },
});
