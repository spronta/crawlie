// Dependency-free SVG charts, themed via CSS variables.

type Slice = { label: string; value: number; color: string };

export function Donut({ slices, size = 132, stroke = 16 }: { slices: Slice[]; size?: number; stroke?: number }) {
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
        {slices.map((s, i) => (
          <div className="item" key={i}>
            <span className="swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="mono muted">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Bars({ rows }: { rows: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r, i) => (
        <div className="bar-row" key={i}>
          <span className="lbl">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || "var(--text)" }} />
          </span>
          <span className="n">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
