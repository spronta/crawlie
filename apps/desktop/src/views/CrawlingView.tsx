import { useEffect, useMemo, useRef, useState } from "react";
import type { CrawlConfig } from "../lib/types";
import { shortUrl } from "../lib/format";

export interface Progress {
  crawled: number;
  discovered: number;
  queued: number;
  current: string;
}

/** Crawler one-liners, rotated while the crawl runs. Dry + on-brand. */
const JOKES = [
  "Following links like breadcrumbs.",
  "Untangling the web, one page at a time.",
  "Teaching robots.txt some manners.",
  "Sniffing out broken links.",
  "Counting H1s — there can be only one.",
  "Chasing redirects down the rabbit hole.",
  "Reading meta descriptions so you don't have to.",
  "Asking every page: got a canonical?",
  "Measuring how citable you are to the robots.",
  "Politely skipping the pages robots.txt hid.",
  "Eight legs, zero patience for 404s.",
  "Reticulating splines… wrong crawler, sorry.",
  "Parsing JSON-LD like it owes us money.",
  "Checking whether your titles are the right length.",
];

function fmtEta(secs: number): string {
  if (!isFinite(secs) || secs <= 0) return "—";
  if (secs < 60) return `${Math.ceil(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function fmtSpeed(rate: number): string {
  if (!isFinite(rate) || rate <= 0) return "—";
  if (rate >= 1) return `${rate.toFixed(1)}/s`;
  return `${Math.round(rate * 60)}/min`;
}

export function CrawlingView({
  config,
  progress,
  onCancel,
  onBackground,
}: {
  config: CrawlConfig;
  progress: Progress;
  onCancel: () => void;
  /** When set, shows a "Run in background" action — the crawl keeps going while the user browses elsewhere. */
  onBackground?: () => void;
}) {
  const verifying = progress.current.startsWith("Verifying");
  // Verify progress rides in the status line as "Verifying links… checked/total".
  const vm = verifying ? /(\d+)\s*\/\s*(\d+)/.exec(progress.current) : null;
  const vChecked = vm ? Number(vm[1]) : 0;
  const vTotal = vm ? Number(vm[2]) : 0;

  // --- Live speed + ETA from a rolling sample of (time, n) --------------
  // n is pages while crawling, links checked while verifying; the sample
  // window resets on the phase flip so the rate isn't a mix of both units.
  const metric = verifying ? vChecked : progress.crawled;
  const samples = useRef<Array<{ t: number; n: number }>>([]);
  const phase = useRef(verifying);
  const [, tick] = useState(0);
  useEffect(() => {
    if (phase.current !== verifying) {
      samples.current = [];
      phase.current = verifying;
    }
    const now = Date.now();
    samples.current.push({ t: now, n: metric });
    while (samples.current.length > 2 && now - samples.current[0].t > 10_000) samples.current.shift();
  }, [metric, verifying]);
  // A slow clock so speed/ETA keep updating between progress events.
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);

  const { rate, eta, pct, estTotal } = useMemo(() => {
    const s = samples.current;
    const first = s[0];
    const last = s[s.length - 1] ?? { t: Date.now(), n: metric };
    const dt = first ? (last.t - first.t) / 1000 : 0;
    const dn = first ? last.n - first.n : 0;
    const rate = dt > 0.5 ? dn / dt : 0;
    // Verify phase: real progress over the known link-check total.
    if (verifying && vTotal > 0) {
      const remaining = Math.max(0, vTotal - vChecked);
      const eta = rate > 0 ? remaining / rate : Infinity;
      const pct = Math.min(100, Math.round((vChecked / vTotal) * 100));
      return { rate, eta, pct, estTotal: vTotal };
    }
    // maxPages can be absent until the server's meta event lands — treat it as
    // uncapped rather than letting NaN poison pct/ETA.
    const cap = Number.isFinite(config.maxPages) && config.maxPages > 0 ? config.maxPages : Infinity;
    const estTotal = Math.max(
      1,
      Math.min(cap, Math.max(progress.crawled + progress.queued, progress.discovered)),
    );
    const remaining = Math.max(0, estTotal - progress.crawled);
    const eta = rate > 0 ? remaining / rate : Infinity;
    const pct = Math.min(100, Math.round((progress.crawled / estTotal) * 100));
    return { rate, eta, pct, estTotal };
    // tick drives the between-event refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.crawled, progress.queued, progress.discovered, config.maxPages, verifying, vChecked, vTotal, metric, tick]);

  const [joke, setJoke] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setJoke((j) => (j + 1) % JOKES.length), 4200);
    return () => clearInterval(id);
  }, []);

  const capped = Number.isFinite(config.maxPages) && progress.discovered > config.maxPages;

  return (
    <div className="crawl-wrap">
      {/* Keep the field alive through link verification — a frozen background reads as a hang. */}
      <PixelField active />
      <div className="crawl-inner">
        <div className="crawl-head">
          <span className="pixel-crawler" aria-hidden="true" />
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="h2" style={{ letterSpacing: "-0.01em" }}>{verifying ? "Verifying links" : "Crawling"}</span>
            <span className="mono tertiary" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340 }}>{shortUrl(config.url)}</span>
          </div>
        </div>

        <div className="crawl-card">
          <div className="crawl-bar-row">
            <span className="crawl-pct mono">{verifying && !vTotal ? "···" : `${pct}%`}</span>
            <PixelBar pct={pct} indeterminate={verifying && !vTotal} />
          </div>

          <div className="crawl-stats">
            {verifying && vTotal > 0 ? (
              <>
                <Stat label="Checked" value={String(vChecked)} />
                <Stat label="Links" value={String(vTotal)} />
                <Stat label="Queued" value={String(progress.queued)} />
                <Stat label="Speed" value={fmtSpeed(rate)} />
                <Stat label="ETA" value={fmtEta(eta)} />
              </>
            ) : (
              <>
                <Stat label="Crawled" value={String(progress.crawled)} />
                <Stat label="Discovered" value={String(progress.discovered)} />
                <Stat label="Queued" value={String(progress.queued)} />
                <Stat label="Speed" value={fmtSpeed(rate)} />
                <Stat label="ETA" value={verifying ? "almost" : fmtEta(eta)} />
              </>
            )}
          </div>

          <div className="crawl-foot">
            <span className="mono tertiary crawl-current">
              {verifying ? progress.current : shortUrl(progress.current || config.url)}
            </span>
            {onBackground && (
              <button className="btn btn-secondary btn-sm" onClick={onBackground}>Run in background</button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          </div>
        </div>

        <div className="crawl-joke mono" key={joke}>
          <span className="crawl-joke-caret">&gt;</span> {JOKES[joke]}
          <span className="crawl-joke-blink">_</span>
        </div>
        {capped && estTotal >= config.maxPages && (
          <div className="tertiary" style={{ font: "var(--copy-13)", textAlign: "center" }}>
            Capped at {config.maxPages} pages for this crawl.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="crawl-stat">
      <span className="crawl-stat-k">{label}</span>
      <span className="crawl-stat-v mono">{value}</span>
    </div>
  );
}

/* Blocky ASCII progress bar — filled / head / empty glyphs in the quantised
   blue. Inherently pixel; smooth because `pct` eases each update. */
function PixelBar({ pct, indeterminate }: { pct: number; indeterminate: boolean }) {
  const SEG = 30;
  if (indeterminate) {
    return <div className="pixel-bar indeterminate" aria-hidden="true">{"░".repeat(SEG)}</div>;
  }
  const filled = Math.max(0, Math.round((pct / 100) * SEG));
  return (
    <div className="pixel-bar" aria-hidden="true">
      {Array.from({ length: SEG }, (_, i) => {
        const cls = i < filled - 1 ? "on" : i === filled - 1 ? "head" : "off";
        return (
          <span key={i} className={`pb-${cls}`}>
            {cls === "off" ? "░" : cls === "head" ? "▓" : "█"}
          </span>
        );
      })}
    </div>
  );
}

/* Canvas field ported from the marketing site's PixelGridBackground: chunky
   block glyphs, quantised blue ramp, low-fps stepped motion, a diagonal scan
   wavefront = the agent crawling. Sits behind the card, masked to a vignette. */
function PixelField({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const CELL = 22;
    const FPS = 12;
    const BLOCKS = [" ", "░", "▒", "▓", "█"];
    const PALETTE = [
      [10, 38, 120],
      [0, 68, 200],
      [0, 85, 238],
      [59, 158, 255],
      [150, 200, 255],
    ];
    let cols = 0, rows = 0, dpr = 1, last = 0, raf = 0, step = 0;
    function resize() {
      const r = parent!.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.ceil(r.width * dpr);
      canvas!.height = Math.ceil(r.height * dpr);
      cols = Math.ceil(r.width / CELL) + 1;
      rows = Math.ceil(r.height / CELL) + 1;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.font = `${CELL}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx!.textBaseline = "top";
    }
    function isLight() {
      const t = document.documentElement.dataset.theme;
      if (t === "light") return true;
      if (t === "dark") return false;
      return window.matchMedia("(prefers-color-scheme: light)").matches;
    }
    function draw(step: number) {
      const T = step * 0.07;
      const aMul = isLight() ? 1.4 : 1;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const span = cols + rows;
      const scan = (T * 4) % (span + 30);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const f = Math.sin(x * 0.55 + T) + Math.sin(y * 0.6 - T * 0.8) + Math.sin(x * 0.6 + y * 0.45 + T * 0.6);
          let n = (f + 3) / 6;
          const d = Math.abs(x + y - scan);
          if (d < 6) n += (1 - d / 6) * 0.34;
          const level = Math.round(Math.min(1, Math.max(0, n)) * (BLOCKS.length - 1));
          if (level <= 0) continue;
          const [r, g, b] = PALETTE[level];
          const alpha = Math.min(0.72, (0.07 + level * 0.075) * aMul);
          ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx!.fillText(BLOCKS[level], x * CELL, y * CELL);
        }
      }
    }
    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      if (!active) return;
      if (now - last < 1000 / FPS) return;
      last = now;
      draw((step = Math.floor(now / (1000 / FPS))));
    }
    resize();
    draw(step); // always paint one frame up front (survives throttled rAF)
    const ro = "ResizeObserver" in window
      ? new ResizeObserver(() => { resize(); draw(reduce ? 40 : step); })
      : null;
    ro?.observe(parent);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [active]);
  return (
    <div className="pixel-field" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
