// Pusar: Electron main process entry point.
import { app } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { findLaunchLink } from "../core/launchLink";
import { installAppProtocol, registerAppScheme } from "./appProtocol";
import { registerIpc } from "./ipc/handlers";
import { handleLaunchLink } from "./linkHandler";
import { log, onLog } from "./logger";
import { useFakeRoblox } from "./platform";
import { installSecurityPolicy } from "./security";
import { runSelfTest } from "./selftest";
import { applyLaunchBehavior, removeTrayIcon, restoreFromTray } from "./tray";
import { createMainWindow, focusMainWindow, getMainWindow } from "./windows";

// Roblox's site should see a normal Chrome user agent, not "Electron/x Pusar/x".
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:pusar|Pusar|Electron)\/\S+/g, "");

// Packaged builds encrypt cookies and source runs can't read those, so the two
// never share a profile. An explicit --user-data-dir still wins.
if (app.isPackaged && !app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), "Pusar Launcher"));
}

registerAppScheme();

const developerFlag = (name: string) => !app.isPackaged && process.argv.includes(name);

/** `npm start` waits for this, so the terminal comes back when Pusar closes (see scripts/dev.mjs). */
function tellDevRunnerWeClosed(): void {
  const marker = process.env.PUSAR_DEV_CLOSED_MARKER;
  if (!marker || app.isPackaged) return;
  try {
    writeFileSync(marker, "");
  } catch {
    // The runner has already gone, so there's nobody to tell.
  }
}

// End-to-end tests point Pusar at a fixture, so mods can never reach a real install.
if (!app.isPackaged && app.commandLine.hasSwitch("fake-roblox-dir")) {
  useFakeRoblox(app.commandLine.getSwitchValue("fake-roblox-dir"));
  // A fake install can't really launch, so tests reach what follows a launch directly.
  Object.assign(globalThis, { __pusarTest: { applyLaunchBehavior, restoreFromTray } });
}

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
  app.on("second-instance", (_event, argv) => {
    const link = findLaunchLink(argv);
    if (link) void handleLaunchLink(link);
    else focusMainWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    log("Pusar closed");
    removeTrayIcon();
    tellDevRunnerWeClosed();
  });

  void app.whenReady().then(async () => {
    // Opened by a roblox-player: link: hand it to Roblox without showing a window.
    const startupLink = findLaunchLink(process.argv);
    if (startupLink) {
      await handleLaunchLink(startupLink);
      app.quit();
      return;
    }

    installSecurityPolicy();
    installAppProtocol(path.join(__dirname, "../renderer"));
    onLog((line) => getMainWindow()?.webContents.send("log", line));
    registerIpc();
    createMainWindow({ spikePanel: developerFlag("--spike") });
    log(`Pusar started (Electron ${process.versions.electron}, ${process.platform}/${process.arch})`);
  });
}
