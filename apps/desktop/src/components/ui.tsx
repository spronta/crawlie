import { useEffect, useState } from "react";
import type { Severity } from "../lib/types";
import { statusClass, statusLabel } from "../lib/format";

/* ---------- Icons (inline, currentColor) ---------- */
type IconProps = { size?: number };
const I = (d: string, size = 16, extra?: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d && <path d={d} />}
    {extra}
  </svg>
);
export const IconSearch = ({ size }: IconProps) => I("m21 21-4.3-4.3", size, <circle cx="11" cy="11" r="8" />);
export const IconChevron = ({ size }: IconProps) => I("m9 18 6-6-6-6", size);
export const IconX = ({ size }: IconProps) => I("M18 6 6 18M6 6l12 12", size);
export const IconDownload = ({ size }: IconProps) => I("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3", size);
export const IconSun = ({ size }: IconProps) => I("M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4", size, <circle cx="12" cy="12" r="4" />);
export const IconMoon = ({ size }: IconProps) => I("M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z", size);
export const IconExternal = ({ size }: IconProps) => I("M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", size);
export const IconRefresh = ({ size }: IconProps) => I("M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5", size);
export const IconArrowRight = ({ size }: IconProps) => I("M5 12h14M12 5l7 7-7 7", size);
export const IconHistory = ({ size }: IconProps) => I("M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2", size);
export const IconTrash = ({ size }: IconProps) => I("M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", size);
export const IconGlobe = ({ size }: IconProps) => I("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20", size);
export const IconSpark = ({ size }: IconProps) => I("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.9 2.4L22 18l-2.1.6L19 21l-.9-2.4L16 18l2.1-.6z", size);
export const IconBack = ({ size }: IconProps) => I("M19 12H5M12 19l-7-7 7-7", size);

/** A circular score gauge (0–100) coloured by band. */
export function ScoreRing({ value, size = 116, stroke = 10, caption }: { value: number; size?: number; stroke?: number; caption?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = value >= 80 ? "var(--green)" : value >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <span className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gray-100)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: "stroke-dasharray 400ms var(--ease)" }}
        />
      </svg>
      <span className="label">
        <span className="n" style={{ fontSize: size * 0.3, color }}>{value}</span>
        {caption && <span className="cap">{caption}</span>}
      </span>
    </span>
  );
}

export function Logo() {
  return (
    <div className="logo">
      <span className="mark">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <span>crawlie</span>
      <span className="by">by Spronta</span>
    </div>
  );
}

/* ---------- Theme toggle ---------- */
export function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.getAttribute("data-theme") || "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return (
    <button className="icon-btn" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

/* ---------- Badges ---------- */
export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  const label = severity[0].toUpperCase() + severity.slice(1);
  return (
    <span className={`badge badge-${severity}`}>
      <span className="dot" />
      {label}
      {count !== undefined && <span className="mono" style={{ opacity: 0.7 }}>{count}</span>}
    </span>
  );
}

export function StatusPill({ status }: { status: number }) {
  return <span className={`status-pill ${statusClass(status)}`}>{statusLabel(status)}</span>;
}

export function Spinner() {
  return <span className="spinner" />;
}
