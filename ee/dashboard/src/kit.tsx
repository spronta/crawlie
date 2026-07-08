// Cohesive UI primitives built on the shared design tokens (not Tailwind/ShadCN,
// so they sit seamlessly next to the reused desktop views). Card, Tabs, Field.

import type { ReactNode } from "react";

export function Card({ title, right, children, style }: { title?: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 14, padding: 20, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
          {title && <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)" }}>{title}</div>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

export function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (id: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 2, padding: "0 20px", borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "12px 12px 11px",
              margin: 0,
              background: "none",
              border: 0,
              borderBottom: `2px solid ${on ? "var(--blue, #0055ee)" : "transparent"}`,
              color: on ? "var(--text)" : "var(--text-secondary)",
              fontSize: 13.5,
              fontWeight: on ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color .12s",
            }}
          >
            {t.icon}
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", background: "var(--panel-2, var(--border))", borderRadius: 999, padding: "1px 7px" }}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 12, color: "var(--muted-2, var(--text-secondary))", marginTop: 5 }}>{hint}</div>}
    </label>
  );
}

export const fieldInput: React.CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: 9,
  border: "1px solid var(--border)",
  background: "var(--bg-soft, var(--bg))",
  color: "var(--text)",
  fontSize: 14,
};
