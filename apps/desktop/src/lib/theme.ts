// Light/dark theme, persisted to localStorage and applied via `data-theme`
// on the document element (the tokens.css variables key off it).

export type Theme = "light" | "dark";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("theme", t);
  } catch {
    /* storage may be unavailable; ignore */
  }
}

/** Apply the saved theme on startup. Defaults to light. */
export function initTheme() {
  let t: Theme = "light";
  try {
    if (localStorage.getItem("theme") === "dark") t = "dark";
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute("data-theme", t);
}
