import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Tauri expects a fixed port and serves the built app from ../dist.
export default defineConfig({
  plugins: [react()],
  // Platform seam: the desktop resolves the app's data/auth layer to its own
  // Tauri-backed `src/lib`. The web dashboard (ee/dashboard) reuses these same
  // views/components but points `@platform/*` at an HTTP + Better Auth layer.
  resolve: {
    alias: {
      "@platform": fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    sourcemap: false,
  },
});
