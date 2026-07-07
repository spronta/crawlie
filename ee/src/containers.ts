// Cloudflare Container that runs the crawlie engine (ee/crawler). The Durable
// Object manages the container lifecycle (start on demand, sleep when idle);
// requests are proxied to the service listening on port 8080.

import { Container } from "@cloudflare/containers";
import type { Env } from "./env";

export class CrawlerContainer extends Container<Env> {
  defaultPort = 8080;
  // Crawls are bursty — keep a warm instance briefly, then scale to zero.
  sleepAfter = "3m";
}
