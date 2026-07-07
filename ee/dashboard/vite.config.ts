import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The dashboard REUSES the desktop app's views/components/styles verbatim
// (`@ui/*` → apps/desktop/src) and injects a web data + auth layer through the
// platform seam (`@platform/*` → this app's src/platform). React must resolve
// to a single copy or hooks break, so react/react-dom are pinned + deduped here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@platform": r("./src/platform"),
      "@ui": r("../../apps/desktop/src"),
      react: r("./node_modules/react"),
      "react-dom": r("./node_modules/react-dom"),
    },
  },
  server: { port: 5174, strictPort: true },
  build: { target: "es2021", outDir: "dist", sourcemap: false },
});
