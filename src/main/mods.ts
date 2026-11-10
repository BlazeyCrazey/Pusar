// The app's one ModsService, created once Electron knows where its data lives.
import { app } from "electron";
import { ModsService } from "../core/modsService";
import type { Platform } from "../shared/types";
import { log } from "./logger";
import { currentPlatform } from "./platform";

let service: ModsService | null = null;
let canApplyNow = () => true;

/** Lets the instance monitor say when a game is running and files must be left alone. */
export function setModsApplyCheck(check: () => boolean): void {
  canApplyNow = check;
}

export function mods(): ModsService {
  service ??= new ModsService({
    dataDir: app.getPath("userData"),
    platform: process.platform as Platform,
    detectInstalls: () => currentPlatform().detectInstalls(),
    isPlayerRunning: () => currentPlatform().isPlayerRunning(),
    killPlayers: () => currentPlatform().killPlayers(),
    canApplyNow: () => canApplyNow(),
    log,
  });
  return service;
}
