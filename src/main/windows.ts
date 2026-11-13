import { app, BrowserWindow } from "electron";
import path from "node:path";
import iconPath from "../../resources/icon.png?asset";
import { APP_ORIGIN } from "../core/appUrl";
import { disposeAllClients } from "./accounts";
import { devRendererUrl, isOwnPage } from "./security";

/** Matches --bg-app and --text-2 in the design tokens. */
const WINDOW_BACKGROUND = "#0f1012";
const TITLE_BAR_SYMBOLS = "#a4a7ae";
export const TITLE_BAR_HEIGHT = 40;

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function focusMainWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

export function createMainWindow(options: { spikePanel: boolean }): BrowserWindow {
  const { spikePanel } = options;
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: spikePanel ? "Pusar · M0 spike panel" : "Pusar",
    backgroundColor: WINDOW_BACKGROUND,
    // Installed builds take the .exe's icon; this covers running from source.
    icon: iconPath,
    autoHideMenuBar: true,
    // The real UI draws its own title bar. Windows still provides the
    // minimize/maximize/close buttons, so Snap Layouts keep working.
    ...(spikePanel
      ? {}
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: WINDOW_BACKGROUND, symbolColor: TITLE_BAR_SYMBOLS, height: TITLE_BAR_HEIGHT },
        }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: app.isPackaged ? [] : ["--pusar-dev"],
    },
  });
  mainWindow = win;

  win.once("ready-to-show", () => win.show());
  win.webContents.on("will-navigate", (event, url) => {
    if (!isOwnPage(url)) event.preventDefault();
  });
  win.on("closed", () => {
    mainWindow = null;
    // Hidden Roblox session windows count as open windows, so without this
    // the app would keep running invisibly and block every later start.
    disposeAllClients();
    app.quit();
  });

  const page = spikePanel ? "spike.html" : "index.html";
  void win.loadURL(`${devRendererUrl() ?? APP_ORIGIN}/${page}`);
  return win;
}
