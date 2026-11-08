// macOS is deferred (PLAN.md §9). This code has never run on a Mac.
import { spawn } from "node:child_process";
import os from "node:os";
import { findMacInstalls } from "../../core/install";
import type { RobloxPlatform } from "./index";

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
};
