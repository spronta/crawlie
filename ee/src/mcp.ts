// Crawlie Cloud MCP — a hosted Model Context Protocol server over HTTP.
//
// This is the stdio `crawlie-mcp` server's cloud twin: any MCP client (Claude,
// Cursor, a custom agent) can point at https://crawlie.app/mcp, authenticate
// with a Crawlie API key, and run hosted crawls + slice saved reports without
// installing anything. Crawls execute on the same container job model as the
// dashboard, are team-scoped, and are metered against the team's plan.
//
// Transport: MCP Streamable HTTP. One endpoint:
//   POST /mcp   — JSON-RPC 2.0. Answers with application/json for quick calls,
//                 or text/event-stream (progress notifications + final result)
//                 for long-running crawls when the client accepts SSE.
//   GET  /mcp   — 405 (we never initiate server→client streams).
//   DELETE/mcp  — 200 (stateless: there is no session to tear down).
//
// Auth: `Authorization: Bearer crw_…` (an account API key) or a session cookie.
// The server is stateless — every request re-authenticates — so no Durable
// Object session state is needed and it scales like the rest of the Worker.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./env";
import { createAuth } from "./auth";
import { userIdForKey } from "./keys";
import { userEmail } from "./alerts";
import {
  resolveTeam,
  getUsage,
  crawlBlockedReason,
  PLANS,
  type Team,
} from "./teams";
import { enabledPackSources } from "./packs";
import { startJob, armWatch, watchState } from "./crawler";
import type { WatchState } from "./containers";
import { loadReport, listReports, diffReports } from "./reports";
import { compactReport, topFixes, affectedUrls, geoIssues, type StoredReport } from "./digest";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "crawlie-cloud";
const SERVER_VERSION = "0.1.0";

// How long a single crawl tool call may hold its request open before handing
// the agent a jobId to poll. The crawl keeps running in the container either
// way, so this only bounds the request, never the work (see the job model in
// ee/src/crawler.ts). Kept well under the eviction window that forced the
// job+poll design in the first place.
const CRAWL_BUDGET_MS = 55_000;
const POLL_INTERVAL_MS = 1_500;

type Vars = { userId: string; email: string; team: Team };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

export const mcp = new Hono<{ Bindings: Env; Variables: Vars }>();

// --- CORS + preflight (bearer-token auth, so no credentialed cookies needed) --
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, accept",
  "access-control-max-age": "600",
};

mcp.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  await next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) c.res.headers.set(k, v);
});

// GET is only meaningful for server-initiated SSE, which we don't offer.
mcp.get("/", (c) => c.json(rpcError(null, -32601, "This MCP server does not support GET; POST JSON-RPC to /mcp."), 405));
// Stateless: nothing to terminate.
mcp.delete("/", (c) => c.body(null, 200));

mcp.post("/", async (c) => {
  // --- Authenticate (API key or session) + resolve the active team ---
  const auth = await authenticate(c);
  if (!auth) {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized. Provide a Crawlie API key as a Bearer token (create one at https://crawlie.app → Settings → API keys)." } },
      401,
      { "www-authenticate": 'Bearer realm="crawlie"' },
    );
  }
  c.set("userId", auth.userId);
  c.set("email", auth.email);
  c.set("team", auth.team);

  const body = await c.req.json().catch(() => null);
  if (body == null) return c.json(rpcError(null, -32700, "Parse error: body is not valid JSON."), 400);

  // Batches: process each message; notifications produce no response.
  if (Array.isArray(body)) {
    const out: unknown[] = [];
    for (const msg of body) {
      const r = await handleMessage(c, msg);
      if (r) out.push(r);
    }
    return out.length ? c.json(out) : c.body(null, 202);
  }

  // A notification (no id) — acknowledge with 202 and no body.
  if (body && typeof body === "object" && !("id" in body)) {
    return c.body(null, 202);
  }

  // A crawl tool call may stream progress; hand it the raw request so it can
  // decide between SSE and a plain JSON response.
  if (isCrawlCall(body) && acceptsEventStream(c)) {
    return streamCrawlCall(c, body);
  }

  const response = await handleMessage(c, body);
  return response ? c.json(response) : c.body(null, 202);
});

// --- Auth ---------------------------------------------------------------
async function authenticate(c: Ctx): Promise<{ userId: string; email: string; team: Team } | null> {
  let userId = "";
  let email = "";
  const header = c.req.header("authorization");
  if (header?.startsWith("Bearer crw_")) {
    const uid = await userIdForKey(c.env, header.slice(7));
    if (uid) {
      userId = uid;
      email = (await userEmail(c.env, uid)) ?? "";
    }
  }
  if (!userId) {
    const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers }).catch(() => null);
    if (!session?.user) return null;
    userId = session.user.id;
    email = session.user.email;
  }
  const team = await resolveTeam(c.env, userId, email, c.req.header("x-crawlie-team"));
  return { userId, email, team };
}

// --- JSON-RPC dispatch --------------------------------------------------
interface RpcMessage {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcOk(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function toolText(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}
function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

/** Handle one JSON-RPC message; returns the response, or null for a notification. */
async function handleMessage(c: Ctx, msg: RpcMessage): Promise<unknown | null> {
  const { id, method } = msg;
  if (id === undefined || id === null) return null; // notification
  const params = (msg.params ?? {}) as Record<string, unknown>;

  switch (method) {
    case "initialize":
      return rpcOk(id, await initialize(c, params));
    case "tools/list":
      return rpcOk(id, { tools: TOOLS });
    case "ping":
      return rpcOk(id, {});
    case "tools/call": {
      try {
        return rpcOk(id, await callTool(c, params));
      } catch (e) {
        return rpcError(id, -32603, (e as Error).message);
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function initialize(c: Ctx, params: Record<string, unknown>): Promise<unknown> {
  const protocol = typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION;
  const team = c.get("team");
  const plan = PLANS[team.plan];
  const usage = await getUsage(c.env, team.id);
  return {
    protocolVersion: protocol,
    capabilities: { tools: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions:
      "Crawlie Cloud: run hosted technical-SEO + GEO audits and slice saved reports. " +
      "Start with crawl_site (whole site) or audit_url (one page); both save a report you can " +
      "re-slice with top_fixes / affected_urls / geo_gaps / diff_reports without re-crawling.",
    crawlieCloud: {
      signedIn: true,
      email: c.get("email"),
      team: { id: team.id, name: team.name, plan: team.plan },
      plan: { label: plan.label, maxPages: plan.maxPages, crawlsPerMonth: plan.crawlsPerMonth },
      usage: { crawls: usage.crawls, remaining: Math.max(0, plan.crawlsPerMonth - usage.crawls), period: usage.period },
    },
  };
}

// --- Tools --------------------------------------------------------------
const CRAWL_CONFIG_KEYS = [
  "url", "maxPages", "maxDepth", "concurrency", "checkExternal", "respectRobots",
  "useSitemap", "render", "renderWaitMs", "include", "exclude", "excludeHosts",
  "excludePaths", "extract",
] as const;

const TOOLS = [
  {
    name: "crawl_site",
    description:
      "Run a hosted technical-SEO + GEO audit of a whole website in Crawlie Cloud. Returns a compact digest (headline, scores, prioritized top fixes, issues grouped by rule with sample URLs) plus a reportId you can re-slice later without re-crawling. Long crawls stream progress; if one exceeds the request window you get a jobId to poll with crawl_status. Counts as one crawl against your plan.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Seed URL (http/https)." },
        maxPages: { type: "integer", description: "Cap pages fetched. Bounded by your plan's per-crawl limit." },
        maxDepth: { type: "integer", description: "Max click depth from the seed." },
        concurrency: { type: "integer", default: 16 },
        checkExternal: { type: "boolean", default: true },
        respectRobots: { type: "boolean", default: true },
        useSitemap: { type: "boolean", default: true },
        render: { type: "boolean", default: false, description: "Render each page with headless Chrome before auditing (JS-heavy sites). Slower." },
        renderWaitMs: { type: "integer", default: 0 },
        include: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } },
      },
      required: ["url"],
    },
  },
  {
    name: "audit_url",
    description: "Audit a single URL in Crawlie Cloud (no crawling beyond the page). Returns the compact SEO + GEO digest and a reportId. Counts as one crawl against your plan.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "crawl_status",
    description: "Poll a crawl started by crawl_site that exceeded the request window. Returns progress while running, or the full digest + reportId once done.",
    inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  },
  {
    name: "list_reports",
    description: "List saved hosted reports for your team (id, url, scores, page counts).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_report",
    description: "Load a saved hosted report. Compact digest by default; set includeIssues/includePages for the full flat lists.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Report id, or 'latest' (default)." },
        includeIssues: { type: "boolean", default: false },
        includePages: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "top_fixes",
    description: "Prioritized fixes for a saved report, optionally scoped to a category (e.g. category='geo'). Operates on the latest report by default.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: { type: "string", description: "Report id, or 'latest' (default)." },
        category: { type: "string" },
        limit: { type: "integer", default: 8 },
      },
    },
  },
  {
    name: "geo_gaps",
    description: "AI-readiness (GEO) issues for a saved report, grouped by rule with sample URLs. Latest report by default.",
    inputSchema: { type: "object", properties: { reportId: { type: "string" } } },
  },
  {
    name: "affected_urls",
    description: "List URLs flagged by a specific rule in a saved report (e.g. rule='geo-no-author').",
    inputSchema: {
      type: "object",
      properties: {
        rule: { type: "string" },
        reportId: { type: "string", description: "Report id, or 'latest' (default)." },
        limit: { type: "integer", default: 100 },
      },
      required: ["rule"],
    },
  },
  {
    name: "diff_reports",
    description: "Compare two saved crawls of the same site: score deltas, pages added/removed, and issues that newly appeared or were resolved. Use it to verify fixes landed between crawls.",
    inputSchema: {
      type: "object",
      properties: {
        oldId: { type: "string", description: "The earlier report id." },
        newId: { type: "string", description: "The later report id, or 'latest' (default)." },
      },
      required: ["oldId"],
    },
  },
] as const;

function isCrawlCall(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as RpcMessage;
  const name = (b.params?.name as string) ?? "";
  return b.method === "tools/call" && (name === "crawl_site" || name === "audit_url");
}

function acceptsEventStream(c: Ctx): boolean {
  return (c.req.header("accept") ?? "").includes("text/event-stream");
}

function pickConfig(args: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const k of CRAWL_CONFIG_KEYS) {
    if (args[k] !== undefined) config[k] = args[k];
  }
  return config;
}

/** Resolve a report id, treating undefined/'latest' as the newest saved report. */
async function resolveReportId(c: Ctx, id: string | undefined): Promise<string | null> {
  if (id && id !== "latest") return id;
  const reports = await listReports(c.env, c.get("team").id);
  return reports[0]?.id ?? null;
}

async function callTool(c: Ctx, params: Record<string, unknown>): Promise<unknown> {
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  switch (name) {
    case "crawl_site":
    case "audit_url":
      // Non-streaming path (client didn't accept SSE): run to completion within
      // the budget, then reply with JSON. Streaming clients are handled earlier.
      return runCrawlTool(c, name, args, () => {});
    case "crawl_status": {
      const jobId = String(args.jobId ?? "");
      if (!jobId) return toolText("jobId is required.", true);
      return pollToToolResult(c, jobId);
    }
    case "list_reports":
      return toolText(pretty(await listReports(c.env, c.get("team").id)));
    case "get_report": {
      const id = await resolveReportId(c, args.id as string | undefined);
      if (!id) return toolText("No saved reports yet. Run crawl_site first.", true);
      const report = await loadReport(c.env, c.get("team").id, id);
      if (!report) return toolText(`Report '${id}' not found.`, true);
      const includeIssues = args.includeIssues === true;
      const includePages = args.includePages === true;
      const payload = compactReport(report as StoredReport) as Record<string, unknown>;
      payload.reportId = id;
      if (includeIssues) payload.issues = (report as StoredReport).issues ?? [];
      if (includePages) payload.pages = report.pages ?? [];
      return toolText(pretty(payload));
    }
    case "top_fixes": {
      const id = await resolveReportId(c, args.reportId as string | undefined);
      if (!id) return toolText("No saved reports yet. Run crawl_site first.", true);
      const report = await loadReport(c.env, c.get("team").id, id);
      if (!report) return toolText(`Report '${id}' not found.`, true);
      const limit = typeof args.limit === "number" ? args.limit : 8;
      const fixes = topFixes(report as StoredReport, args.category as string | undefined, limit);
      return toolText(pretty({ reportId: id, topFixes: fixes }));
    }
    case "geo_gaps": {
      const id = await resolveReportId(c, args.reportId as string | undefined);
      if (!id) return toolText("No saved reports yet. Run crawl_site first.", true);
      const report = await loadReport(c.env, c.get("team").id, id);
      if (!report) return toolText(`Report '${id}' not found.`, true);
      return toolText(pretty({ reportId: id, geoIssues: geoIssues(report as StoredReport) }));
    }
    case "affected_urls": {
      const rule = String(args.rule ?? "");
      if (!rule) return toolText("rule is required.", true);
      const id = await resolveReportId(c, args.reportId as string | undefined);
      if (!id) return toolText("No saved reports yet. Run crawl_site first.", true);
      const report = await loadReport(c.env, c.get("team").id, id);
      if (!report) return toolText(`Report '${id}' not found.`, true);
      const limit = typeof args.limit === "number" ? args.limit : 100;
      return toolText(pretty(affectedUrls(report as StoredReport, rule, limit)));
    }
    case "diff_reports": {
      const oldId = String(args.oldId ?? "");
      if (!oldId) return toolText("oldId is required.", true);
      const newId = await resolveReportId(c, args.newId as string | undefined);
      if (!newId) return toolText("No later report to diff against.", true);
      const diff = await diffReports(c.env, c.get("team").id, oldId, newId);
      return diff ? toolText(pretty(diff)) : toolText(`One or both reports not found ('${oldId}', '${newId}').`, true);
    }
    default:
      return toolText(`Unknown tool: ${name}`, true);
  }
}

// --- Crawl execution (shared by the JSON and SSE paths) -----------------

/** Start a crawl job (bounding pages to the plan) and arm the Durable Object
 *  watcher, which owns saving + metering from here. Returns the jobId. */
async function startCrawl(c: Ctx, name: string, args: Record<string, unknown>): Promise<string> {
  const team = c.get("team");
  const cap = PLANS[team.plan].maxPages;
  const config = pickConfig(args);
  if (name === "audit_url") {
    config.maxPages = 1;
    config.maxDepth = 0;
  }
  const requested = typeof config.maxPages === "number" && config.maxPages > 0 ? config.maxPages : cap;
  config.maxPages = Math.min(requested, cap);
  const jobId = crypto.randomUUID();
  const packs = await enabledPackSources(c.env, team.id);
  await startJob(c.env, jobId, config, packs);
  await armWatch(c.env, { jobId, teamId: team.id, userId: c.get("userId"), projectId: null });
  return jobId;
}

/** A finished (DO-saved) report as a compact tool payload. */
async function savedToolResult(c: Ctx, reportId: string): Promise<unknown> {
  const report = await loadReport(c.env, c.get("team").id, reportId);
  if (!report) return toolText("Report saved but could not be loaded.", true);
  const payload = compactReport(report as StoredReport) as Record<string, unknown>;
  payload.reportId = reportId;
  return toolText(pretty(payload));
}

/** Poll once and turn the job state into a tool result (used by crawl_status). */
async function pollToToolResult(c: Ctx, jobId: string): Promise<unknown> {
  let st: WatchState;
  try {
    st = await watchState(c.env, jobId);
  } catch {
    return toolText("Lost contact with the crawler. Try starting the crawl again.", true);
  }
  if (st.status === "running") {
    return toolText(pretty({ status: "running", jobId, crawled: st.crawled ?? 0, discovered: st.discovered ?? 0, current: st.current }));
  }
  if (st.status === "saving") {
    return toolText(pretty({ status: "running", jobId, note: "Crawl finished; the report is being saved. Poll crawl_status again." }));
  }
  if (st.status === "error") return toolText(st.message ?? "The crawl failed.", true);
  if (st.status === "done" && st.reportId) return savedToolResult(c, st.reportId);
  return toolText("The crawl is no longer available. Please run it again.", true);
}

/**
 * Run a crawl tool to completion within the request budget. Streams progress
 * via `onProgress` (used by the SSE path). If the budget elapses first, returns
 * a "running" result carrying the jobId so the agent can poll crawl_status.
 */
async function runCrawlTool(
  c: Ctx,
  name: string,
  args: Record<string, unknown>,
  onProgress: (st: WatchState) => void,
): Promise<unknown> {
  const blocked = await crawlBlockedReason(c.env, c.get("team"));
  if (blocked) return toolText(blocked, true);

  let jobId: string;
  try {
    jobId = await startCrawl(c, name, args);
  } catch (e) {
    return toolText(`Could not start the crawl: ${(e as Error).message}`, true);
  }

  const deadline = Date.now() + CRAWL_BUDGET_MS;
  for (;;) {
    if (c.req.raw.signal?.aborted) return toolText(pretty({ status: "running", jobId, note: "Client disconnected; the crawl continues. Poll crawl_status." }));

    let st: WatchState;
    try {
      st = await watchState(c.env, jobId);
    } catch {
      return toolText("Lost contact with the crawler. Try again.", true);
    }

    if (st.status === "running" || st.status === "saving") {
      onProgress(st);
      if (Date.now() >= deadline) {
        return toolText(pretty({
          status: "running",
          jobId,
          crawled: st.crawled ?? 0,
          discovered: st.discovered ?? 0,
          note: "Still crawling. Call crawl_status with this jobId to get the result.",
        }));
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (st.status === "error") return toolText(st.message ?? "The crawl failed.", true);
    if (st.status === "done" && st.reportId) return savedToolResult(c, st.reportId);
    return toolText("The crawl is no longer available. Please run it again.", true);
  }
}

// --- SSE for crawl tool calls -------------------------------------------
function streamCrawlCall(c: Ctx, body: RpcMessage): Response {
  const id = body.id;
  const params = (body.params ?? {}) as Record<string, unknown>;
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const progressToken = (params._meta as Record<string, unknown> | undefined)?.progressToken;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const frame = (obj: unknown) => writer.write(encoder.encode(`event: message\ndata: ${JSON.stringify(obj)}\n\n`));

  const run = async () => {
    try {
      const onProgress = (st: WatchState) => {
        if (progressToken === undefined) return;
        void frame({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: {
            progressToken,
            progress: st.crawled ?? 0,
            total: st.discovered ?? undefined,
            message: st.current ? `Crawling ${st.current}` : `Crawled ${st.crawled ?? 0}`,
          },
        });
      };
      const result = await runCrawlTool(c, name, args, onProgress);
      await frame(rpcOk(id, result));
    } catch (e) {
      await frame(rpcError(id, -32603, (e as Error).message));
    } finally {
      await writer.close().catch(() => {});
    }
  };
  // Keep the invocation alive until the stream closes.
  c.executionCtx.waitUntil(run());

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...CORS_HEADERS,
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
