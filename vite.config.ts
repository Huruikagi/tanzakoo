import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: { watch: { ignored: ["**/src-tauri/**", "**/.local/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});
