// Pusar: Electron main process entry point.
import { app } from "electron";
import path from "node:path";
import { installAppProtocol, registerAppScheme } from "./appProtocol";
import { registerIpc } from "./ipc/handlers";
import { log, onLog } from "./logger";
import { installSecurityPolicy } from "./security";
import { runSelfTest } from "./selftest";
import { createMainWindow, focusMainWindow, getMainWindow } from "./windows";

// Roblox's site should see a normal Chrome user agent, not "Electron/x Pusar/x".
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:pusar|Pusar|Electron)\/\S+/g, "");

registerAppScheme();

const developerFlag = (name: string) => !app.isPackaged && process.argv.includes(name);

if (developerFlag("--selftest")) {
  // The self-test opens and closes hidden windows; without this listener
  // Electron quits as soon as the last one closes, before results are written.
  app.on("window-all-closed", () => {});
  void app.whenReady().then(async () => {
    const code = await runSelfTest();
    app.exit(code);
  });
} else if (!app.requestSingleInstanceLock()) {
  console.log("Pusar is already running, so this copy is exiting.");
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(() => {
    installSecurityPolicy();
    installAppProtocol(path.join(__dirname, "../renderer"));
    onLog((line) => getMainWindow()?.webContents.send("log", line));
    registerIpc();
    createMainWindow({ spikePanel: developerFlag("--spike") });
    log(`Pusar started (Electron ${process.versions.electron}, ${process.platform}/${process.arch})`);
  });
}
