// The tray icon that stands in for the window while a game is running.
import { app, Menu, nativeImage, Tray } from "electron";
import trayIconPath from "../../resources/tray.png?asset";
import type { LaunchBehavior } from "../shared/types";
import { focusMainWindow, getMainWindow } from "./windows";

let tray: Tray | null = null;

export function removeTrayIcon(): void {
  tray?.destroy();
  tray = null;
}

export function hideToTray(): void {
  const win = getMainWindow();
  if (!win) return;
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(trayIconPath));
    tray.setToolTip("Pusar");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Pusar", click: focusMainWindow },
        { type: "separator" },
        { label: "Quit Pusar", click: () => app.quit() },
      ]),
    );
    tray.on("click", focusMainWindow);
  }
  // However the window comes back, the icon has done its job.
  win.once("show", removeTrayIcon);
  win.hide();
}

/** Brings the window back if Pusar is sitting in the tray, and otherwise leaves it alone. */
export function restoreFromTray(): void {
  if (tray) focusMainWindow();
}

/** Lets the launch's reply reach the window before it goes away. */
const CLOSE_DELAY_MS = 300;

export function applyLaunchBehavior(behavior: LaunchBehavior | undefined): void {
  if (behavior === "tray") hideToTray();
  else if (behavior === "close") setTimeout(() => app.quit(), CLOSE_DELAY_MS);
}
