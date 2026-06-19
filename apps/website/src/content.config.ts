import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // Lower numbers sort first in the sidebar.
    order: z.number().default(99),
    // Sidebar group heading.
    section: z.string().default('Guide'),
  }),
});

export const collections = { docs };
