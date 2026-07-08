// Tiny history-based router — real URLs without a router dependency. The Worker
// serves the SPA for any non-API path (assets single-page-application fallback),
// so these routes resolve on refresh + deep-link.

import { useEffect, useState } from "react";

export type Route =
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "report"; id: string }
  | { name: "new" }
  | { name: "account" }
  | { name: "public"; token: string };

export function parse(path: string): Route {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/p\/([A-Za-z0-9]+)/))) return { name: "public", token: m[1] };
  if ((m = path.match(/^\/projects\/([^/]+)/))) return { name: "project", id: decodeURIComponent(m[1]) };
  if ((m = path.match(/^\/reports\/([^/]+)/))) return { name: "report", id: decodeURIComponent(m[1]) };
  if (path.startsWith("/account")) return { name: "account" };
  if (path.startsWith("/new")) return { name: "new" };
  return { name: "projects" }; // "/" and "/projects"
}

const listeners = new Set<() => void>();

export function navigate(path: string): void {
  if (path !== location.pathname) history.pushState({}, "", path);
  listeners.forEach((l) => l());
}

export function back(): void {
  if (history.length > 1) history.back();
  else navigate("/projects");
}

export function useRoute(): Route {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    window.addEventListener("popstate", fn);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("popstate", fn);
    };
  }, []);
  return parse(location.pathname);
}
