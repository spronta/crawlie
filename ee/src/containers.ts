// Cloudflare Container that runs the crawlie engine (ee/crawler), plus the
// Durable Object logic that makes hosted crawls durable: the DO — not the
// browser — watches a running job and persists the finished report.
//
// Lifecycle of a big crawl:
//   1. /v1 arms the watcher (POST /__watch/arm) right after starting the job.
//   2. The DO polls the container's /status on a persistent schedule() loop —
//      the crawl keeps running (and the container stays awake) even if the
//      user closes the tab.
//   3. On completion the DO pulls the report as bounded artifacts (lean meta,
//      page index, page chunks) and streams them into R2 one piece at a time,
//      writes the D1 row, meters the crawl exactly once, fires scheduled-crawl
//      regression alerts, then tells the container to clean up.
//
// Save progress is checkpointed in DO storage (nextChunk), so an eviction
// mid-save resumes where it left off instead of re-uploading everything.

import { Container } from "@cloudflare/containers";
import type { Env } from "./env";

/** Seconds between job status checks while a crawl runs. */
const POLL_SECONDS = 10;
/** Seconds to wait before retrying a failed save step. */
const RETRY_SECONDS = 15;
/** Give up watching after this many consecutive failures. */
const MAX_FAILURES = 20;

/** Context needed to persist + meter a finished crawl, stored when armed. */
export interface WatchInfo {
  jobId: string;
  teamId: string;
  userId: string;
  projectId: string | null;
  /** Scheduled-crawl context (regression alerts). Absent for interactive runs. */
  scheduled?: {
    projectName: string;
    notify: boolean;
    notifyWebhook: string | null;
    lastHealth: number | null;
    lastReport: string | null;
  };
}

/** What the dashboard's poll sees. */
export interface WatchState {
  status: "running" | "saving" | "done" | "error" | "unknown";
  crawled?: number;
  discovered?: number;
  queued?: number;
  current?: string;
  savedChunks?: number;
  chunkCount?: number;
  reportId?: string;
  message?: string;
}

interface SaveProgress {
  reportId: string;
  chunkCount: number;
  pageCount: number;
  chunkSize: number;
  nextChunk: number;
  metaSaved: boolean;
  indexSaved: boolean;
  rowSaved: boolean;
  metered: boolean;
}

interface LeanSummary {
  totalPages: number;
  errors: number;
  warnings: number;
  healthScore: number;
  geoScore: number;
  a11yScore: number;
  startedAt: number;
  url: string;
  packScore: number | null;
}

export class CrawlerContainer extends Container<Env> {
  defaultPort = 8080;
  // Crawls are bursty — keep a warm instance briefly, then scale to zero. The
  // watcher's 10s status checks count as activity, so a running crawl never
  // idles out even with no browser attached.
  sleepAfter = "3m";

  /** Intercept watcher control routes; everything else proxies to the container. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__watch/arm" && request.method === "POST") {
      const info = await request.json<WatchInfo>();
      await this.ctx.storage.put("watch", info);
      await this.schedule(POLL_SECONDS, "checkJob");
      return Response.json({ ok: true });
    }
    if (url.pathname === "/__watch/state") {
      return Response.json(await this.watchState());
    }
    return super.fetch(request);
  }

  /** Current job state, combining save progress with live container status. */
  private async watchState(): Promise<WatchState> {
    const outcome = await this.ctx.storage.get<WatchState>("outcome");
    if (outcome) return outcome;
    const save = await this.ctx.storage.get<SaveProgress>("save");
    if (save) {
      return {
        status: "saving",
        savedChunks: save.nextChunk,
        chunkCount: save.chunkCount,
      };
    }
    const watch = await this.ctx.storage.get<WatchInfo>("watch");
    if (!watch) return { status: "unknown" };
    // Live progress straight from the container.
    try {
      const st = await this.jobStatus(watch.jobId);
      if (st.status === "running") {
        return {
          status: "running",
          crawled: st.crawled,
          discovered: st.discovered,
          queued: st.queued,
          current: st.current,
        };
      }
      if (st.status === "done") return { status: "saving", savedChunks: 0 };
      if (st.status === "error") return { status: "error", message: st.message };
      return { status: "running" };
    } catch {
      return { status: "running" };
    }
  }

  private async jobStatus(jobId: string): Promise<{
    status: string;
    crawled?: number;
    discovered?: number;
    queued?: number;
    current?: string;
    message?: string;
    pageCount?: number;
    pageChunkSize?: number;
    summary?: LeanSummary;
  }> {
    const res = await this.containerFetch(
      `http://crawler/status?job=${encodeURIComponent(jobId)}`,
      { method: "GET" },
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res.json();
  }

  /**
   * The watch loop, driven by the persistent schedule(). Re-arms itself while
   * the crawl runs; performs the (resumable) save when it finishes.
   */
  async checkJob(): Promise<void> {
    const watch = await this.ctx.storage.get<WatchInfo>("watch");
    if (!watch) return;
    if (await this.ctx.storage.get("outcome")) return; // already settled

    try {
      const st = await this.jobStatus(watch.jobId);
      if (st.status === "running") {
        this.renewActivityTimeout();
        await this.schedule(POLL_SECONDS, "checkJob");
        return;
      }
      if (st.status === "error") {
        await this.settle({ status: "error", message: st.message ?? "crawl failed" });
        return;
      }
      if (st.status === "unknown") {
        // Container restarted mid-crawl; the job is gone.
        await this.settle({
          status: "error",
          message: "The crawl was interrupted. Please run it again.",
        });
        return;
      }
      if (st.status === "saved") {
        // A previous save completed but the outcome write raced; recover it.
        const save = await this.ctx.storage.get<SaveProgress>("save");
        if (save) await this.settle({ status: "done", reportId: save.reportId });
        return;
      }
      // done → persist everything (resumable across retries/evictions).
      await this.saveArtifacts(watch, st.pageCount ?? 0, st.pageChunkSize ?? 200, st.summary);
    } catch (err) {
      const failures = ((await this.ctx.storage.get<number>("failures")) ?? 0) + 1;
      await this.ctx.storage.put("failures", failures);
      if (failures >= MAX_FAILURES) {
        await this.settle({
          status: "error",
          message: `Saving the report failed repeatedly: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      await this.schedule(RETRY_SECONDS, "checkJob");
    }
  }

  /** Record the final state, stop watching, and shut the container down.
   *  Containers bill per active second and would otherwise idle for the full
   *  `sleepAfter` window (3m) after the job settles — often several times the
   *  crawl itself on small crawls. Every settle path means nothing will talk
   *  to this instance again (each job gets its own DO), so stop immediately. */
  private async settle(outcome: WatchState): Promise<void> {
    await this.ctx.storage.put("outcome", outcome);
    await this.ctx.storage.delete("failures");
    // Drop the job from the reattach registry (best-effort; GET /v1/crawls
    // also prunes stale rows lazily).
    try {
      const watch = await this.ctx.storage.get<WatchInfo>("watch");
      if (watch) {
        const { clearActiveCrawl } = await import("./crawler");
        await clearActiveCrawl(this.env, watch.jobId);
      }
    } catch (err) {
      console.error("active-crawl clear failed:", err);
    }
    try {
      await this.stop();
    } catch {
      /* already stopped or never started */
    }
  }

  /**
   * Pull the finished crawl out of the container as bounded artifacts and
   * persist them: lean report + page index + page chunks to R2, metadata row
   * to D1, metering + alerts once. Progress lives in DO storage so a crash
   * resumes mid-save.
   */
  private async saveArtifacts(
    watch: WatchInfo,
    pageCount: number,
    chunkSize: number,
    summary?: LeanSummary,
  ): Promise<void> {
    const { reportIdFor, reportKey, reportPartKey, saveReportRow } = await import("./reports");

    let save = await this.ctx.storage.get<SaveProgress>("save");
    if (!save) {
      if (!summary) throw new Error("job finished without a summary");
      save = {
        reportId: reportIdFor(summary.startedAt, summary.url),
        chunkCount: Math.ceil(pageCount / Math.max(1, chunkSize)),
        pageCount,
        chunkSize,
        nextChunk: 0,
        metaSaved: false,
        indexSaved: false,
        rowSaved: false,
        metered: false,
      };
      await this.ctx.storage.put("save", save);
      await this.ctx.storage.put("summary", summary);
    }
    const sum = summary ?? (await this.ctx.storage.get<LeanSummary>("summary"));
    if (!sum) throw new Error("missing crawl summary");
    const job = encodeURIComponent(watch.jobId);

    // 1. The lean report (summary + rollup + capped issues — no pages).
    if (!save.metaSaved) {
      const res = await this.containerFetch(`http://crawler/result/meta?job=${job}`, { method: "GET" });
      if (!res.ok) throw new Error(`meta ${res.status}`);
      await this.env.REPORTS.put(reportKey(watch.teamId, save.reportId), await res.text(), {
        httpMetadata: { contentType: "application/json" },
      });
      save.metaSaved = true;
      await this.ctx.storage.put("save", save);
    }

    // Artifacts arrive pre-gzipped (marked via x-crawlie-gzip, not
    // Content-Encoding, so workerd doesn't transparently inflate them here).
    // They're stored compressed with the real contentEncoding on the R2
    // object — ~10x less transfer through this loop and at rest.
    const putArtifact = async (part: string, res: Response) => {
      const gzip = res.headers.get("x-crawlie-gzip") === "1";
      await this.env.REPORTS.put(reportPartKey(watch.teamId, save!.reportId, part), await res.arrayBuffer(), {
        httpMetadata: { contentType: "application/json", ...(gzip ? { contentEncoding: "gzip" } : {}) },
      });
    };

    // 2. The compact page index.
    if (!save.indexSaved) {
      const res = await this.containerFetch(`http://crawler/result/index?job=${job}`, { method: "GET" });
      if (!res.ok) throw new Error(`index ${res.status}`);
      await putArtifact("index.json", res);
      save.indexSaved = true;
      await this.ctx.storage.put("save", save);
    }

    // 3. Page chunks, pulled in small parallel batches (resume granularity =
    // one batch): cuts the save phase — container awake time — ~4x.
    const BATCH = 4;
    while (save.nextChunk < save.chunkCount) {
      const batch = Array.from(
        { length: Math.min(BATCH, save.chunkCount - save.nextChunk) },
        (_, i) => save!.nextChunk + i,
      );
      await Promise.all(
        batch.map(async (n) => {
          const res = await this.containerFetch(
            `http://crawler/result/pages?job=${job}&offset=${n * save!.chunkSize}&limit=${save!.chunkSize}`,
            { method: "GET" },
          );
          if (!res.ok) throw new Error(`pages chunk ${n}: ${res.status}`);
          await putArtifact(`pages/${n}.json`, res);
        }),
      );
      save.nextChunk += batch.length;
      await this.ctx.storage.put("save", save);
      this.renewActivityTimeout();
    }

    // 4. The D1 listing row.
    if (!save.rowSaved) {
      await saveReportRow(this.env, watch.teamId, watch.userId, save.reportId, {
        url: sum.url,
        createdAt: sum.startedAt,
        totalPages: sum.totalPages,
        errors: sum.errors,
        warnings: sum.warnings,
        healthScore: sum.healthScore,
        geoScore: sum.geoScore,
        a11yScore: sum.a11yScore,
        projectId: watch.projectId,
        packScore: typeof sum.packScore === "number" ? sum.packScore : null,
      });
      save.rowSaved = true;
      await this.ctx.storage.put("save", save);
    }

    // 5. Metering + project trend + alerts, exactly once.
    if (!save.metered) {
      const { incrementCrawls } = await import("./teams");
      await incrementCrawls(this.env, watch.teamId);
      if (watch.projectId) {
        const { recordCrawl } = await import("./projects");
        await recordCrawl(this.env, watch.teamId, watch.projectId, save.reportId, sum.healthScore, Date.now());
      }
      save.metered = true;
      await this.ctx.storage.put("save", save);
      if (watch.scheduled) {
        // Best-effort: alerts must never wedge the save loop.
        try {
          await this.maybeAlert(watch, save.reportId, sum);
        } catch (err) {
          console.error("regression alert failed:", err);
        }
      }
    }

    // 6. Tell the container it can free the job's disk + memory.
    try {
      await this.containerFetch("http://crawler/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: watch.jobId, reportId: save.reportId }),
      });
    } catch {
      /* the instance will idle out and wipe its scratch space on next boot */
    }

    await this.settle({ status: "done", reportId: save.reportId });
  }

  /** Scheduled-crawl regression detection + notifications (email/webhook). */
  private async maybeAlert(watch: WatchInfo, reportId: string, sum: LeanSummary): Promise<void> {
    const s = watch.scheduled;
    if (!s?.notify) return;
    const HEALTH_DROP = 3;

    let regressed = s.lastHealth != null && sum.healthScore <= s.lastHealth - HEALTH_DROP;
    let newErrors = 0;
    let newWarnings = 0;
    if (s.lastReport) {
      const { diffReports } = await import("./reports");
      const diff = await diffReports(this.env, watch.teamId, s.lastReport, reportId);
      if (diff) {
        for (const i of diff.newIssues) {
          if (i.severity === "error") newErrors += i.count;
          else if (i.severity === "warning") newWarnings += i.count;
        }
        if (newErrors > 0) regressed = true;
      }
      // Content regression: rule-pack violations increased vs the previous crawl.
      if (typeof sum.packScore === "number") {
        const prev = await this.env.DB.prepare(`SELECT pack_score FROM reports WHERE team_id = ? AND id = ?`)
          .bind(watch.teamId, s.lastReport)
          .first<{ pack_score: number | null }>();
        if (prev?.pack_score != null && sum.packScore > prev.pack_score + 0.5) regressed = true;
      }
    }
    if (!regressed) return;

    const { sendRegressionAlert, sendWebhookAlert, userEmail } = await import("./alerts");
    const alert = {
      projectName: s.projectName,
      url: sum.url,
      healthBefore: s.lastHealth ?? sum.healthScore,
      healthAfter: sum.healthScore,
      newErrors,
      newWarnings,
      reportUrl: `https://crawlie.app/projects/${watch.projectId}`,
    };
    const email = await userEmail(this.env, watch.userId);
    if (email) await sendRegressionAlert(this.env, email, alert);
    if (s.notifyWebhook) await sendWebhookAlert(s.notifyWebhook, alert);
  }
}
