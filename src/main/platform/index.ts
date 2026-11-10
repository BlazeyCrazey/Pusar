// Everything that differs between operating systems sits behind this interface.
import type { ChildProcess } from "node:child_process";
import { findWindowsInstalls } from "../../core/install";
import type { RobloxInstall } from "../../shared/types";
import { macPlatform } from "./mac";
import { windowsPlatform } from "./win";

/** Where the OS records which app opens roblox-player: links. */
export interface LinkHandlerRegistry {
  read(): Promise<string | null>;
  write(command: string): Promise<void>;
}

export interface RobloxPlatform {
  detectInstalls(): Promise<RobloxInstall[]>;
  /** Starts Roblox. With no argument, it opens the Roblox app's home screen. */
  spawnPlayer(install: RobloxInstall, launchUri?: string): ChildProcess;
  isPlayerRunning(): Promise<boolean>;
  /** Force-closes every Roblox player process. */
  killPlayers(): Promise<void>;
  linkHandler?: LinkHandlerRegistry;
}

const unsupportedPlatform: RobloxPlatform = {
  detectInstalls: async () => [],
  spawnPlayer: () => {
    throw new Error("Roblox isn't supported on this operating system.");
  },
  isPlayerRunning: async () => false,
  killPlayers: async () => {},
};

let fakePlatform: RobloxPlatform | null = null;

/** For tests: treat a folder as the Roblox install, so they can never touch the real one. */
export function useFakeRoblox(localAppData: string): void {
  fakePlatform = {
    detectInstalls: async () => findWindowsInstalls({ localAppData }),
    spawnPlayer: () => {
      throw new Error("Can't start Roblox from a fake install.");
    },
    isPlayerRunning: async () => false,
    killPlayers: async () => {},
  };
}

export function usingFakeRoblox(): boolean {
  return fakePlatform !== null;
}

export function currentPlatform(): RobloxPlatform {
  if (fakePlatform) return fakePlatform;
  if (process.platform === "win32") return windowsPlatform;
  if (process.platform === "darwin") return macPlatform;
  return unsupportedPlatform;
}
