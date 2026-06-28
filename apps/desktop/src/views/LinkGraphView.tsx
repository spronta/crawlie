import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CrawlResult } from "../lib/types";

// Internal-link graph view. The layout is computed ONCE (a bounded force sim in
// a useMemo, with a hard work cap so it can never freeze the UI) and rendered as
// static SVG — no canvas, no requestAnimationFrame loop, no manual hit-testing.
// Pan/zoom is applied imperatively to a single <g transform> so dragging never
// re-renders the whole graph. This is deliberately boring and robust.

const MAX_GRAPH_NODES = 600; // beyond this a node-link diagram is a useless hairball

type XY = { x: number; y: number };

function computeLayout(
  nodes: { linkScore: number }[],
  edges: [number, number][]
): { pos: XY[]; minX: number; minY: number; maxX: number; maxY: number } {
  const n = nodes.length;
  const p: { x: number; y: number; vx: number; vy: number }[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = 200 + (i % 9) * 20;
    p[i] = { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 };
  }
  // Iterations scale inversely with n^2, so total work stays ~1M ops regardless
  // of graph size — the layout always finishes near-instantly.
  const iters = Math.min(280, Math.max(8, Math.floor(2_000_000 / (n * n + 1))));
  const REPULSE = 4200;
  const SPRING = 0.02;
  const REST = 74;
  const CENTER = 0.02;
  const MAX_V = 30;
  let a = 1;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const pi = p[i];
      for (let j = i + 1; j < n; j++) {
        const pj = p[j];
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (i - j) * 0.5 + 0.5;
          dy = ((i * 7 + j) % 11) - 5 + 0.5;
          d2 = dx * dx + dy * dy + 1;
        }
        const d = Math.sqrt(d2);
        const f = (REPULSE * a) / Math.max(d2, 144);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        pi.vx += fx;
        pi.vy += fy;
        pj.vx -= fx;
        pj.vy -= fy;
      }
    }
    for (const [s, t] of edges) {
      const ps = p[s];
      const pt = p[t];
      if (!ps || !pt) continue;
      const dx = pt.x - ps.x;
      const dy = pt.y - ps.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = SPRING * (d - REST) * a;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      ps.vx += fx;
      ps.vy += fy;
      pt.vx -= fx;
      pt.vy -= fy;
    }
    for (let i = 0; i < n; i++) {
      const pi = p[i];
      pi.vx += -pi.x * CENTER * a;
      pi.vy += -pi.y * CENTER * a;
      pi.vx *= 0.85;
      pi.vy *= 0.85;
      let sp = Math.sqrt(pi.vx * pi.vx + pi.vy * pi.vy);
      if (!Number.isFinite(sp)) {
        pi.x = (i % 30) * 14 - 200;
        pi.y = (((i * 13) % 30) - 15) * 14;
        pi.vx = 0;
        pi.vy = 0;
        sp = 0;
      }
      if (sp > MAX_V) {
        pi.vx = (pi.vx / sp) * MAX_V;
        pi.vy = (pi.vy / sp) * MAX_V;
      }
      pi.x += pi.vx;
      pi.y += pi.vy;
    }
    a *= 0.97;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pos = p.map((q) => {
    const x = Number.isFinite(q.x) ? q.x : 0;
    const y = Number.isFinite(q.y) ? q.y : 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    return { x, y };
  });
  if (!Number.isFinite(minX)) {
    minX = -1;
    minY = -1;
    maxX = 1;
    maxY = 1;
  }
  return { pos, minX, minY, maxX, maxY };
}

export function LinkGraphView({
  result,
  onOpenUrl,
}: {
  result: CrawlResult;
  onOpenUrl: (url: string) => void;
}) {
  const graph = result.linkGraph;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const tooBig = nodes.length > MAX_GRAPH_NODES;

  const layout = useMemo(
    () => (nodes.length === 0 || tooBig ? null : computeLayout(nodes, edges)),
    [nodes, edges, tooBig]
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<number | null>(null);

  const radii = useMemo(
    () => nodes.map((nd) => 4 + Math.sqrt(Math.max(0, nd.linkScore)) * 1.4),
    [nodes]
  );

  // One <path> for every edge; one more for the selected node's edges.
  const edgePath = useMemo(() => {
    if (!layout) return "";
    let d = "";
    for (const [s, t] of edges) {
      const a = layout.pos[s];
      const b = layout.pos[t];
      if (!a || !b) continue;
      d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    return d;
  }, [layout, edges]);

  const selPath = useMemo(() => {
    if (!layout || selected == null) return "";
    let d = "";
    for (const [s, t] of edges) {
      if (s !== selected && t !== selected) continue;
      const a = layout.pos[s];
      const b = layout.pos[t];
      if (!a || !b) continue;
      d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    return d;
  }, [layout, edges, selected]);

  const applyTransform = () => {
    const g = gRef.current;
    if (!g) return;
    const v = view.current;
    g.setAttribute("transform", `translate(${v.x} ${v.y}) scale(${v.k})`);
  };

  // Fit the graph to the viewport once it's laid out and measured.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !layout) return;
    const r = wrap.getBoundingClientRect();
    const W = Math.max(1, r.width);
    const H = Math.max(1, r.height);
    const gw = layout.maxX - layout.minX || 1;
    const gh = layout.maxY - layout.minY || 1;
    const pad = 60;
    let k = Math.min(1.5, Math.max(0.15, Math.min((W - pad) / gw, (H - pad) / gh)));
    if (!Number.isFinite(k) || k <= 0) k = 0.6;
    view.current = {
      k,
      x: W / 2 - ((layout.minX + layout.maxX) / 2) * k,
      y: H / 2 - ((layout.minY + layout.maxY) / 2) * k,
    };
    applyTransform();
  }, [layout]);

  // --- pan / zoom (imperative; never re-renders the SVG body) ---
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    view.current.x += dx;
    view.current.y += dy;
    d.x = e.clientX;
    d.y = e.clientY;
    applyTransform();
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (d && !d.moved) setSelected(null); // click on empty space clears selection
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const v = view.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const nk = Math.min(4, Math.max(0.1, v.k * factor));
    v.x = cx - (cx - v.x) * (nk / v.k);
    v.y = cy - (cy - v.y) * (nk / v.k);
    v.k = nk;
    applyTransform();
  };

  if (!graph || nodes.length === 0) {
    return (
      <div style={{ padding: "var(--sp-6)", color: "var(--text-secondary)" }}>
        No link graph for this crawl. (Very large crawls keep pages on disk and skip the in-memory
        graph.)
      </div>
    );
  }

  const sel = selected != null ? nodes[selected] : null;
  const maxDepth = Math.max(1, graph.maxDepth);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)", alignItems: "center" }}>
        <Metric label="Nodes" value={nodes.length} />
        <Metric label="Edges" value={edges.length} />
        <Metric label="Orphans" value={graph.orphans} tone={graph.orphans ? "red" : undefined} />
        <Metric label="Dead ends" value={graph.deadEnds} tone={graph.deadEnds ? "amber" : undefined} />
        <Metric label="Avg outlinks" value={graph.avgOutlinks.toFixed(1)} />
        <Metric label="Max depth" value={graph.maxDepth} />
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-4)", fontSize: "var(--label-12)", color: "var(--text-tertiary)" }}>
          <Legend color="var(--blue)" label="page" />
          <Legend color="var(--red)" label="orphan" />
          <Legend color="var(--amber)" label="dead end" />
        </div>
      </div>

      {tooBig ? (
        <Panels graph={graph} nodes={nodes} onOpenUrl={onOpenUrl} note={`Graph view is omitted for very large crawls (${nodes.length} pages). Here's the structure that matters:`} />
      ) : (
        <div
          ref={wrapRef}
          style={{
            position: "relative",
            flex: 1,
            minHeight: 380,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-subtle)",
            overflow: "hidden",
          }}
        >
          <svg
            width="100%"
            height="100%"
            style={{ display: "block", cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          >
            <g ref={gRef}>
              <path d={edgePath} fill="none" stroke="var(--border-strong)" strokeWidth={1} opacity={0.6} />
              {selPath && <path d={selPath} fill="none" stroke="var(--blue)" strokeWidth={1.6} opacity={0.9} />}
              {layout &&
                nodes.map((nd, i) => {
                  const pt = layout.pos[i];
                  if (!pt) return null;
                  const fill = nd.orphan ? "var(--red)" : nd.deadEnd ? "var(--amber)" : "var(--blue)";
                  const op = nd.orphan || nd.deadEnd ? 1 : 0.5 + 0.5 * (1 - nd.depth / maxDepth);
                  return (
                    <circle
                      key={i}
                      cx={pt.x}
                      cy={pt.y}
                      r={radii[i]}
                      fill={fill}
                      fillOpacity={op}
                      stroke={i === selected ? "var(--text)" : "none"}
                      strokeWidth={i === selected ? 2 : 0}
                      style={{ cursor: "pointer" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected((s) => (s === i ? null : i));
                      }}
                    >
                      <title>{nd.url}</title>
                    </circle>
                  );
                })}
            </g>
          </svg>

          {sel && (
            <div
              style={{
                position: "absolute",
                bottom: "var(--sp-3)",
                left: "var(--sp-3)",
                right: "var(--sp-3)",
                padding: "var(--sp-3) var(--sp-4)",
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-pop)",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-4)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--copy-13)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sel.url}
                </div>
                <div style={{ fontSize: "var(--label-12)", color: "var(--text-tertiary)", marginTop: 2 }}>
                  authority {Math.round(sel.linkScore)} · {sel.inlinks} in · {sel.outlinks} out · depth {sel.depth}
                  {sel.orphan ? " · orphan" : ""}
                  {sel.deadEnd ? " · dead end" : ""}
                </div>
              </div>
              <button className="btn" onClick={() => onOpenUrl(sel.url)}>
                Open
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* Bulletproof fallback (also reusable) — the link structure as ranked lists. */
function Panels({
  graph,
  nodes,
  onOpenUrl,
  note,
}: {
  graph: NonNullable<CrawlResult["linkGraph"]>;
  nodes: NonNullable<CrawlResult["linkGraph"]>["nodes"];
  onOpenUrl: (url: string) => void;
  note?: string;
}) {
  const auth = graph.topAuthorities.map((i) => nodes[i]).filter(Boolean).slice(0, 10);
  const hubs = graph.topHubs.map((i) => nodes[i]).filter(Boolean).slice(0, 10);
  const orphans = nodes.filter((n) => n.orphan).slice(0, 20);
  const deadEnds = nodes.filter((n) => n.deadEnd).slice(0, 20);
  return (
    <div style={{ overflowY: "auto", minHeight: 0, flex: 1, display: "grid", gap: "var(--sp-5)", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
      {note && <p style={{ gridColumn: "1 / -1", margin: 0, color: "var(--text-secondary)", fontSize: "var(--copy-14)" }}>{note}</p>}
      <List title="Top authority" items={auth.map((n) => ({ url: n.url, meta: `${Math.round(n.linkScore)}` }))} onOpenUrl={onOpenUrl} />
      <List title="Biggest hubs" items={hubs.map((n) => ({ url: n.url, meta: `${n.outlinks} out` }))} onOpenUrl={onOpenUrl} />
      <List title="Orphans" items={orphans.map((n) => ({ url: n.url, meta: "no inlinks" }))} onOpenUrl={onOpenUrl} />
      <List title="Dead ends" items={deadEnds.map((n) => ({ url: n.url, meta: "no outlinks" }))} onOpenUrl={onOpenUrl} />
    </div>
  );
}

function List({ title, items, onOpenUrl }: { title: string; items: { url: string; meta: string }[]; onOpenUrl: (u: string) => void }) {
  return (
    <div>
      <h3 className="h3" style={{ marginBottom: "var(--sp-3)" }}>{title}</h3>
      {items.length === 0 ? (
        <p style={{ color: "var(--text-tertiary)", fontSize: "var(--copy-13)" }}>None</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => onOpenUrl(it.url)}
              style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-3)", textAlign: "left", background: "none", border: "none", padding: "4px 0", cursor: "pointer", color: "var(--text)" }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--copy-13)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortUrl(it.url)}</span>
              <span style={{ flex: "0 0 auto", fontSize: "var(--label-12)", color: "var(--text-tertiary)" }}>{it.meta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "var(--red)" : tone === "amber" ? "var(--amber)" : "var(--text)";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: "var(--heading-20)", fontWeight: 600, color }}>{value}</span>
      <span style={{ fontSize: "var(--label-12)", color: "var(--text-tertiary)" }}>{label}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function shortUrl(u: string): string {
  try {
    const p = new URL(u);
    const path = p.pathname === "/" ? "/" : p.pathname.replace(/\/$/, "");
    return path.length > 42 ? "…" + path.slice(-40) : path || "/";
  } catch {
    return u.length > 42 ? "…" + u.slice(-40) : u;
  }
}
