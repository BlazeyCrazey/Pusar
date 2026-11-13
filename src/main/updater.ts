// Connects UpdateService to electron-updater in installed builds.
import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { UpdateService, type Updater } from "../core/updates";
import type { UpdateStatus } from "../shared/types";
import { errorMessage, log } from "./logger";

/**
 * electron-builder writes app-update.yml only when the build has somewhere to
 * publish to (see docs/RELEASING.md). Without it there's nothing to check.
 */
function updateFeedConfigured(): boolean {
  return app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

export async function createUpdateService(onChange: (status: UpdateStatus) => void, beta: boolean): Promise<UpdateService> {
  if (!updateFeedConfigured()) return new UpdateService(null, onChange, log);
  try {
    // Loaded only here, so runs from source never touch it.
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.logger = null;
    const runningBeta = app.getVersion().includes("-");
    const service = new UpdateService(autoUpdater as unknown as Updater, onChange, log, Date.now, runningBeta);
    service.setBeta(beta);
    return service;
  } catch (err) {
    log(`Updates: couldn't start (${errorMessage(err)})`);
    return new UpdateService(null, onChange, log);
  }
}
