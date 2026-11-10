// macOS is deferred (PLAN.md §9). This code has never run on a Mac.
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { findMacInstalls } from "../../core/install";
import type { RobloxPlatform } from "./index";

const run = promisify(execFile);

export const macPlatform: RobloxPlatform = {
  async detectInstalls() {
    return findMacInstalls({ home: os.homedir() });
  },

  // macOS hands the URI to the app the same way clicking a link does.
  spawnPlayer(install, launchUri) {
    return spawn("open", ["-a", install.playerPath, ...(launchUri ? [launchUri] : [])], {
      detached: true,
      stdio: "ignore",
    });
  },

  async isPlayerRunning() {
    try {
      await run("pgrep", ["-x", "RobloxPlayer"]);
      return true;
    } catch {
      return false;
    }
  },

  async killPlayers() {
    await run("pkill", ["-x", "RobloxPlayer"]).catch(() => {});
  },
};
