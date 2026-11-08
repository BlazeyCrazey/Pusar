import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build as esbuild } from "esbuild";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

const PAGE_SCRIPT_ID = "virtual:roblox-session-page";

/**
 * Bundles the script injected into hidden roblox.com pages (with roblox-bat)
 * and exposes it to the main process as a string, so it ships inside the
 * main bundle and doesn't depend on a file path at runtime.
 */
function robloxSessionPagePlugin(): Plugin {
  const resolvedId = `\0${PAGE_SCRIPT_ID}`;
  return {
    name: "pusar-roblox-session-page",
    resolveId: (id) => (id === PAGE_SCRIPT_ID ? resolvedId : null),
    async load(id) {
      if (id !== resolvedId) return null;
      const entry = resolve("src/page/robloxSession.ts");
      this.addWatchFile(entry);
      const result = await esbuild({
        entryPoints: [entry],
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        target: "chrome120",
        minify: true,
      });
      return `export default ${JSON.stringify(result.outputFiles[0]!.text)};`;
    },
  };
}

export default defineConfig({
  main: {
    plugins: [robloxSessionPagePlugin()],
  },
  preload: {
    // Sandboxed preload scripts can't load modules, so everything is bundled.
    build: { externalizeDeps: false },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    build: {
      minify: true,
      // Keep fonts as files: the Content Security Policy blocks data: URLs.
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          // Developer-only test panel from M0. Excluded from packaged builds.
          spike: resolve("src/renderer/spike.html"),
        },
      },
    },
  },
});
