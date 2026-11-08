// Everything that differs between operating systems sits behind this interface.
import type { ChildProcess } from "node:child_process";
import type { RobloxInstall } from "../../shared/types";
import { macPlatform } from "./mac";
import { windowsPlatform } from "./win";

export interface RobloxPlatform {
  detectInstalls(): Promise<RobloxInstall[]>;
  /** Starts Roblox. With no argument, it opens the Roblox app's home screen. */
  spawnPlayer(install: RobloxInstall, launchUri?: string): ChildProcess;
}

const unsupportedPlatform: RobloxPlatform = {
  detectInstalls: async () => [],
  spawnPlayer: () => {
    throw new Error("Roblox isn't supported on this operating system.");
  },
};

export function currentPlatform(): RobloxPlatform {
  if (process.platform === "win32") return windowsPlatform;
  if (process.platform === "darwin") return macPlatform;
  return unsupportedPlatform;
}
