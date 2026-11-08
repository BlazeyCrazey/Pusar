// Bundles the Electron main process, preload, and the script injected into
// roblox.com pages. Run from the project root (npm scripts do this).
import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

const common = { bundle: true, logLevel: "warning", sourcemap: true };

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.js",
    platform: "node",
    format: "cjs",
    target: "node22",
    // Loaded from node_modules at runtime.
    external: ["electron", "@xhayper/discord-rpc"],
  }),
  build({
    ...common,
    entryPoints: ["src/main/preload.ts"],
    outfile: "dist/preload.js",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  // Runs inside a hidden roblox.com page (isolated world), so it is bundled
  // as a self-contained browser script that includes roblox-bat.
  build({
    ...common,
    sourcemap: false,
    entryPoints: ["src/page/robloxSession.ts"],
    outfile: "dist/page/robloxSession.js",
    platform: "browser",
    format: "iife",
    target: "chrome120",
  }),
]);

await cp("src/renderer", "dist/renderer", { recursive: true });
console.log("build ok");
