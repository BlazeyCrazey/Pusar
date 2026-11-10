import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { findWindowsInstalls } from "../../core/install";
import type { LinkHandlerRegistry, RobloxPlatform } from "./index";

const run = promisify(execFile);

const ROBLOX_PLAYER_KEY = "HKCU\\Software\\Classes\\roblox-player\\shell\\open\\command";
const PLAYER_PROCESS = "RobloxPlayerBeta.exe";

async function isPlayerRunning(): Promise<boolean> {
  const { stdout } = await run("tasklist", ["/FI", `IMAGENAME eq ${PLAYER_PROCESS}`, "/FO", "CSV", "/NH"], {
    windowsHide: true,
  });
  return stdout.toLowerCase().includes(PLAYER_PROCESS.toLowerCase());
}

/** Reads and writes the (Default) value of one registry key. No shell is involved. */
export function registryDefaultValue(key: string): LinkHandlerRegistry {
  return {
    async read() {
      try {
        const { stdout } = await run("reg", ["query", key, "/ve"], { windowsHide: true });
        return /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(stdout)?.[1]?.trim() ?? null;
      } catch {
        return null;
      }
    },
    async write(command) {
      await run("reg", ["add", key, "/ve", "/d", command, "/f"], { windowsHide: true });
    },
  };
}

const linkHandler = registryDefaultValue(ROBLOX_PLAYER_KEY);

export const windowsPlatform: RobloxPlatform = {
  linkHandler,

  async detectInstalls() {
    return findWindowsInstalls({
      localAppData: process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      protocolHandlerCommand: await linkHandler.read(),
    });
  },

  spawnPlayer(install, launchUri) {
    return spawn(install.playerPath, launchUri ? [launchUri] : ["--app"], {
      cwd: install.rootDir,
      detached: true,
      stdio: "ignore",
    });
  },

  isPlayerRunning,

  async killPlayers() {
    try {
      await run("taskkill", ["/F", "/IM", PLAYER_PROCESS], { windowsHide: true });
    } catch (err) {
      // taskkill also fails when there's nothing to kill, which is fine.
      if (await isPlayerRunning()) throw err;
    }
  },
};
