// Runs electron-vite, and gives the terminal back when Pusar closes.
//
// electron-vite can stay running after Electron has exited (seen 2026-11-09 with
// Roblox still open), so Pusar leaves a marker as it quits and this ends the tool.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** electron-vite normally ends by itself within this long. */
const GRACE_MS = 1500;
const POLL_MS = 200;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "node_modules", "electron-vite", "bin", "electron-vite.js");
const folder = mkdtempSync(path.join(os.tmpdir(), "pusar-dev-"));
const marker = path.join(folder, "closed");

const tool = spawn(process.execPath, [cli, "dev", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PUSAR_DEV_CLOSED_MARKER: marker },
});

let closedAt = 0;
const watch = setInterval(() => {
  if (!existsSync(marker)) return;
  closedAt ||= Date.now();
  if (Date.now() - closedAt < GRACE_MS) return;
  // Only the tool itself. Ending its process tree could also take Roblox with it.
  tool.kill("SIGKILL");
  finish(0);
}, POLL_MS);

function finish(code) {
  clearInterval(watch);
  rmSync(folder, { recursive: true, force: true });
  process.exit(code);
}

tool.on("error", (err) => {
  console.error(err);
  finish(1);
});
tool.on("exit", (code) => finish(code ?? 1));
