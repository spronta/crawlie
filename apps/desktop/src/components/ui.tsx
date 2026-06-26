import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
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
export const IconBook = ({ size }: IconProps) => I("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z", size);
export const IconRefresh = ({ size }: IconProps) => I("M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5", size);
export const IconArrowRight = ({ size }: IconProps) => I("M5 12h14M12 5l7 7-7 7", size);
export const IconHistory = ({ size }: IconProps) => I("M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2", size);
export const IconTrash = ({ size }: IconProps) => I("M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", size);
export const IconGlobe = ({ size }: IconProps) => I("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20", size);
export const IconSpark = ({ size }: IconProps) => I("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.9 2.4L22 18l-2.1.6L19 21l-.9-2.4L16 18l2.1-.6z", size);
export const IconBack = ({ size }: IconProps) => I("M19 12H5M12 19l-7-7 7-7", size);
export const IconShare = ({ size }: IconProps) => I("M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13", size);
export const IconSettings = ({ size }: IconProps) =>
  I("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6", size);

/* ---------- Toggle switch ---------- */
export function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`switch${on ? " on" : ""}`}
        onClick={() => onChange(!on)}
      >
        <span className="knob" />
      </button>
    </div>
  );
}

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
      {/* Icon-only mark — shown when the sidebar is collapsed. */}
      <span className="mark-only" aria-hidden="true">
        <svg width="20" height="22" viewBox="0 0 401 430" fill="none">
          <path d="M174.795 364.538H304.606V430H0V125.791H174.795V364.538ZM401 304.209H226.205V65.4623H96.3943V0H401V304.209Z" fill="currentColor" />
        </svg>
      </span>
      {/* Full lockup — shown when expanded. Monochrome, follows the theme. */}
      <span className="lockup" role="img" aria-label="crawlie">
        <svg width="96" height="20" viewBox="0 0 2061 430" fill="none" aria-hidden="true">
          <g fill="currentColor">
            <path d="M1933.75 397.683C1908.08 397.683 1885.58 391.849 1866.25 380.183C1847.25 368.183 1832.58 352.016 1822.25 331.683C1811.91 311.016 1806.75 287.683 1806.75 261.683C1806.75 235.683 1811.91 212.516 1822.25 192.183C1832.58 171.516 1847.25 155.349 1866.25 143.683C1885.58 131.683 1908.08 125.683 1933.75 125.683C1959.41 125.683 1981.75 131.516 2000.75 143.183C2020.08 154.849 2034.75 171.349 2044.75 192.683C2055.08 213.683 2060.25 237.849 2060.25 265.183V280.183H1864.75C1867.41 302.183 1874.58 319.516 1886.25 332.183C1898.25 344.849 1914.08 351.183 1933.75 351.183C1949.41 351.183 1962.58 347.849 1973.25 341.183C1984.25 334.183 1992.58 324.516 1998.25 312.183H2055.25C2046.91 338.516 2031.91 359.349 2010.25 374.683C1988.91 390.016 1963.41 397.683 1933.75 397.683ZM2001.25 237.183C1997.91 216.849 1990.41 201.016 1978.75 189.683C1967.08 178.016 1952.08 172.183 1933.75 172.183C1915.08 172.183 1899.91 178.016 1888.25 189.683C1876.58 201.016 1869.08 216.849 1865.75 237.183H2001.25Z" />
            <path d="M1725.93 131.683H1783.43V391.683H1725.93V131.683ZM1725.93 31.6826H1783.43V88.1826H1725.93V31.6826Z" />
            <path d="M1645.24 31.6826V320.683C1645.24 329.683 1647.24 336.183 1651.24 340.183C1655.24 344.183 1661.74 346.183 1670.74 346.183H1705.24V391.683H1657.24C1633.9 391.683 1616.4 386.849 1604.74 377.183C1593.4 367.516 1587.74 350.849 1587.74 327.183V31.6826H1645.24Z" />
            <path d="M1370.29 203.683L1315.29 391.683H1255.79L1163.79 131.683H1226.29L1287.29 323.183L1342.29 131.683H1398.29L1452.79 322.683L1514.29 131.683H1576.29L1484.79 391.683H1424.79L1370.29 203.683Z" />
            <path d="M1105.19 361.183C1094.52 374.183 1082.36 383.516 1068.69 389.183C1055.02 394.849 1039.69 397.683 1022.69 397.683C993.691 397.683 970.691 390.849 953.691 377.183C936.691 363.516 928.191 344.349 928.191 319.683C928.191 297.349 936.191 279.849 952.191 267.183C968.191 254.516 992.858 245.183 1026.19 239.183L1103.19 225.183V208.683C1103.19 196.016 1099.19 186.683 1091.19 180.683C1083.19 174.349 1070.69 171.183 1053.69 171.183C1037.36 171.183 1023.86 174.683 1013.19 181.683C1002.52 188.349 996.858 199.016 996.191 213.683H939.191C939.858 184.349 950.858 162.349 972.191 147.683C993.525 133.016 1020.52 125.683 1053.19 125.683C1088.52 125.683 1115.02 132.516 1132.69 146.183C1150.69 159.516 1159.69 178.349 1159.69 202.683V391.683H1105.19V361.183ZM1033.69 353.683C1052.69 353.683 1069.02 348.349 1082.69 337.683C1096.36 327.016 1103.19 311.183 1103.19 290.183V265.683L1036.69 279.183C1019.36 282.849 1006.69 287.349 998.691 292.683C991.025 297.683 987.191 306.016 987.191 317.683C987.191 328.683 991.025 337.516 998.691 344.183C1006.69 350.516 1018.36 353.683 1033.69 353.683Z" />
            <path d="M765.902 131.683H821.402V177.683C838.069 145.016 864.736 128.683 901.402 128.683H921.402V182.183H898.902C874.902 182.183 856.236 188.349 842.902 200.683C829.902 212.683 823.402 233.349 823.402 262.683V391.683H765.902V131.683Z" />
            <path d="M627 397.683C601.667 397.683 579.333 391.849 560 380.183C541 368.183 526.333 352.016 516 331.683C506 311.016 501 287.683 501 261.683C501 235.683 506 212.516 516 192.183C526.333 171.516 541 155.349 560 143.683C579.333 131.683 601.667 125.683 627 125.683C660.667 125.683 687.667 134.516 708 152.183C728.667 169.849 741 193.516 745 223.183H687C684 208.183 677.167 196.349 666.5 187.683C656.167 179.016 643 174.683 627 174.683C605.333 174.683 588.667 182.516 577 198.183C565.667 213.849 560 235.016 560 261.683C560 288.349 565.667 309.516 577 325.183C588.667 340.849 605.333 348.683 627 348.683C643.333 348.683 656.667 344.183 667 335.183C677.667 325.849 684.333 313.183 687 297.183H745C741.333 327.516 729 351.849 708 370.183C687 388.516 660 397.683 627 397.683Z" />
            <path d="M174.795 364.538H304.606V430H0V125.791H174.795V364.538ZM401 304.209H226.205V65.4623H96.3943V0H401V304.209Z" />
          </g>
        </svg>
      </span>
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
const SEV_ICON = {
  error: CircleAlert,
  warning: TriangleAlert,
  notice: Info,
  good: CircleCheck,
} as const;

export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  const label = severity[0].toUpperCase() + severity.slice(1);
  const Icon = SEV_ICON[severity];
  return (
    <span className={`badge badge-${severity}`}>
      <Icon size={13} strokeWidth={2.25} />
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
