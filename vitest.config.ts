import { defineConfig } from "vitest/config";
import path from "path";

// Kept separate from vite.config.ts (which is tuned for the Tauri dev server).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
