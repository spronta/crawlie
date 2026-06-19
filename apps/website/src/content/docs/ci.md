---
title: CI & automation
description: Gate deploys on SEO and GEO health with crawlie's non-zero exit codes — a ready-to-paste GitHub Actions workflow, thresholds, and agent-driven checks.
section: Reference
order: 7
---

crawlie is built to run unattended. `--fail-on` makes it a quality gate: it exits
non-zero when findings at or above a severity exist, which fails the job.

## GitHub Actions

```yaml
name: SEO gate
on: [deployment_status]

jobs:
  crawlie:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Audit the deploy
        run: npx -y -p @spronta/crawlie crawlie crawl "$SITE_URL" --fail-on error --quiet
        env:
          SITE_URL: ${{ github.event.deployment_status.target_url }}
```

Pin a version for reproducible runs: `@spronta/crawlie@0.2.0`.

## Thresholds

| `--fail-on` | Fails when… |
|---|---|
| `none` (default) | never — informational only |
| `error` | any **error**-severity finding exists |
| `warning` | any **error** or **warning** finding exists |

## Pre-launch checks for agents

If you drive CI through an agent, the [`pre-launch-seo-check` skill](/docs/skills-and-plugin)
wraps this into a go / no-go verdict with the exact blockers listed. The agent runs the
same `--fail-on` semantics and reports what to fix before you ship.

## GitLab CI

The same idea works in any pipeline — the non-zero exit code fails the job:

```yaml
seo_gate:
  image: node:20
  script:
    - npx -y -p @spronta/crawlie crawlie crawl "$SITE_URL" --fail-on error --quiet
```

## How do I read the result in CI?

The exit code is the gate: **0** means no findings at or above your threshold, **non-zero**
means the build should stop. For detail, add `--format json -o report.json` and archive it
as a build artifact — the JSON includes the Health and GEO scores, every finding with its
severity and rule id, and per-page data, so you can diff runs or surface a summary in the
job log.

## Should I gate on errors or warnings?

Start with `--fail-on error`. Errors are unambiguous breakage — broken links, 5xx pages,
missing titles on indexable pages — and rarely produce false positives, so they make a
safe blocking gate. Treat warnings and notices as informational at first; once your site
is consistently clean, tighten to `--fail-on warning` to hold the higher bar.

## Tips

- Audit a few critical pages instead of a full crawl for a fast gate:
  `crawlie audit "$HOME_URL" "$PRICING_URL" --quiet`.
- Save baselines with `--save` so you can compare runs over time.
- Use `--format json -o report.json` to archive the full result as a build artifact.
- Pin the version (`@spronta/crawlie@0.2.0`) so a new release can't change your gate's
  behavior mid-pipeline.
