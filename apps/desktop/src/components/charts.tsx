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

type Row = { label: string; value: number; color?: string; key?: string };

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
