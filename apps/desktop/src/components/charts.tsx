// Dependency-free SVG charts, themed via CSS variables. Rows can be clickable
// to drive cross-filtering (click a category → see those issues, etc).

type Slice = { label: string; value: number; color: string; key?: string };

export function Donut({
  slices,
  size = 132,
  stroke = 16,
  onSelect,
}: {
  slices: Slice[];
  size?: number;
  stroke?: number;
  onSelect?: (key: string) => void;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gray-100)" strokeWidth={stroke} />
        {total > 0 &&
          slices.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="legend">
        {slices.map((s, i) => {
          const clickable = !!onSelect && s.key !== undefined && s.value > 0;
          return (
            <div
              className={`item ${clickable ? "clickable" : ""}`}
              key={i}
              onClick={clickable ? () => onSelect!(s.key!) : undefined}
            >
              <span className="swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              <span className="mono muted">{s.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type PSeg = { label: string; value: number; color: string; key?: string };

/** A single horizontal strip split into proportional coloured segments, with a
 *  legend beneath — for compositions where one bar per row adds no insight
 *  (status-code mix, depth distribution). Colour carries the meaning. */
export function ProportionBar({ segments, onSelect }: { segments: PSeg[]; onSelect?: (key: string) => void }) {
  const rows = segments.filter((s) => s.value > 0);
  const total = Math.max(1, rows.reduce((a, s) => a + s.value, 0));
  return (
    <div className="prop">
      <div className="prop-bar">
        {rows.map((s, i) => (
          <span
            key={i}
            className="prop-seg"
            title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="prop-legend">
        {rows.map((s, i) => {
          const clickable = !!onSelect && s.key !== undefined;
          return (
            <div
              key={i}
              className={`prop-item${clickable ? " clickable" : ""}`}
              onClick={clickable ? () => onSelect!(s.key!) : undefined}
            >
              <span className="swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              <span className="mono muted">{s.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Row = { label: string; value: number; color?: string; key?: string };

type Seg = { label: string; value: number; color: string };
type StackRow = { label: string; key?: string; total: number; segments: Seg[] };

/** Horizontal bars split into coloured severity segments, so each row shows the
 *  breakdown (errors / warnings / notices) at a glance, not just a total. */
export function StackedBars({ rows, onSelect }: { rows: StackRow[]; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div>
      {rows.map((r, i) => {
        const clickable = !!onSelect && r.key !== undefined;
        return (
          <div
            className={`bar-row ${clickable ? "clickable" : ""}`}
            key={i}
            onClick={clickable ? () => onSelect!(r.key!) : undefined}
          >
            <span className="lbl">{r.label}</span>
            <span className="bar-track stacked">
              {r.segments
                .filter((s) => s.value > 0)
                .map((s, j) => (
                  <span
                    key={j}
                    className="bar-seg"
                    title={`${s.label}: ${s.value}`}
                    style={{ width: `${(s.value / max) * 100}%`, background: s.color }}
                  />
                ))}
            </span>
            <span className="n">{r.total}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Bars({ rows, onSelect }: { rows: Row[]; onSelect?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r, i) => {
        const clickable = !!onSelect && r.key !== undefined;
        return (
          <div
            className={`bar-row ${clickable ? "clickable" : ""}`}
            key={i}
            onClick={clickable ? () => onSelect!(r.key!) : undefined}
          >
            <span className="lbl">{r.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || "var(--text)" }} />
            </span>
            <span className="n">{r.value}</span>
          </div>
        );
      })}
    </div>
  );
}
