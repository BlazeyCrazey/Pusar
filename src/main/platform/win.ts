import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { findWindowsInstalls } from "../../core/install";
import type { RobloxPlatform } from "./index";

function readProtocolHandler(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", "HKCU\\Software\\Classes\\roblox-player\\shell\\open\\command", "/ve"],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const match = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(stdout);
        resolve(match?.[1]?.trim() ?? null);
      },
    );
  });
}

export const windowsPlatform: RobloxPlatform = {
  async detectInstalls() {
    return findWindowsInstalls({
      localAppData: process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      protocolHandlerCommand: await readProtocolHandler(),
    });
  },

  spawnPlayer(install, launchUri) {
    return spawn(install.playerPath, launchUri ? [launchUri] : ["--app"], {
      cwd: install.rootDir,
      detached: true,
      stdio: "ignore",
    });
  },
};
