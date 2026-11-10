import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  // The compute engine loads lazily; found at runtime, the dev server would reload the page mid-typing.
  optimizeDeps: { include: ["mathlive", "katex", "@cortex-js/compute-engine"] },
});
