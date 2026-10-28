import { defineConfig } from "vite";

// relative base so the same build works on GitHub Pages under /ontoCompute/
export default defineConfig({ base: "./", worker: { format: "es" }, build: { chunkSizeWarningLimit: 4000 } });
