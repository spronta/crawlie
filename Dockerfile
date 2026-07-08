# Crawlie Cloud hosted-crawl container (ee/crawler). Built + pushed by wrangler
# on `wrangler deploy`; run by the CrawlerContainer Durable Object. Build context
# is the repo root so the cargo workspace (crates/crawlie-core + ee/crawler) is
# available. crawlie-core uses rustls, so no OpenSSL is needed at runtime.
FROM rust:1-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY ee/crawler ./ee/crawler
RUN cargo build --release -p crawlie-crawler-service --bin crawlie-crawler-service

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/crawlie-crawler-service /usr/local/bin/crawlie-crawler-service
ENV PORT=8080
EXPOSE 8080
CMD ["crawlie-crawler-service"]
