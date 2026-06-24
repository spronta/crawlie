// The named author behind crawlie's content. A real Person with credentials is
// a strong E-E-A-T / GEO signal — used both as visible bylines/bios and in the
// JSON-LD `author` on compare pages and release notes.

const SITE = 'https://crawlie.dev';

export const AUTHOR = {
  name: 'Sean Ryan',
  // Leads the byline/bio.
  tagline: 'Creator, crawlie',
  jobTitle: 'Founder',
  url: 'https://www.linkedin.com/in/sean-exe',
  image: '/sean-avatar.png',
  bio: "Self-taught since his teens, Sean scaled a community gaming network past a million users before most people finish school. After six-plus years across B2B and B2C tech, spanning engineering, product and marketing, he founded Spronta to build the tools agentic marketing needs. crawlie is the first.",
  knowsAbout: [
    'Technical SEO',
    'Generative Engine Optimization',
    'Agentic marketing',
    'Web crawling',
    'Structured data',
  ],
};

/** schema.org Person for the JSON-LD `author` field. */
export function authorLd() {
  return {
    '@type': 'Person',
    name: AUTHOR.name,
    url: AUTHOR.url,
    jobTitle: AUTHOR.jobTitle,
    description: AUTHOR.bio,
    worksFor: { '@type': 'Organization', name: 'Spronta', url: SITE },
    image: new URL(AUTHOR.image, SITE).href,
    sameAs: [AUTHOR.url],
    knowsAbout: AUTHOR.knowsAbout,
  };
}
