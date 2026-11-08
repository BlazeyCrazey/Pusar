// Shows the real roblox.com login page in a fresh, persistent partition.
// The user types their password, solves the captcha and does 2FA themselves;
// Pusar never reads or fills the form. We only watch for the session cookie.
import { BrowserWindow, session, type Cookie } from "electron";
import { describeNetError } from "../core/network";
import { log } from "./logger";
import { hardenSession, lockToRoblox } from "./robloxWeb";

const LOGIN_URL = "https://www.roblox.com/login";

export function runLoginWindow(partition: string, parent?: BrowserWindow): Promise<"success" | "cancelled"> {
  const ses = session.fromPartition(partition);
  hardenSession(ses);

  const win = new BrowserWindow({
    width: 480,
    height: 760,
    title: "Sign in to Roblox",
    parent,
    autoHideMenuBar: true,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  lockToRoblox(win.webContents);

  return new Promise((resolve, reject) => {
    let finished = false;
    let succeeding = false;

    const finish = (result: "success" | "cancelled" | Error) => {
      if (finished) return;
      finished = true;
      ses.cookies.off("changed", onCookieChanged);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const checkCookie = async () => {
      const cookies = await ses.cookies.get({ url: "https://www.roblox.com", name: ".ROBLOSECURITY" });
      if (cookies.length === 0 || finished || succeeding) return;
      succeeding = true;
      log("Login: session created");
      // Let the post-login page settle, then make sure the device key Roblox
      // just wrote to IndexedDB is flushed to disk before closing.
      setTimeout(() => {
        ses.flushStorageData();
        finish("success");
        if (!win.isDestroyed()) win.close();
      }, 1500);
    };

    const onCookieChanged = (_event: Electron.Event, cookie: Cookie, _cause: string, removed: boolean) => {
      if (cookie.name === ".ROBLOSECURITY" && !removed) void checkCookie();
    };

    ses.cookies.on("changed", onCookieChanged);
    win.webContents.on("did-navigate", () => void checkCookie());
    win.on("closed", () => finish("cancelled"));

    win.loadURL(LOGIN_URL).catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err);
      // ERR_ABORTED just means a redirect replaced the navigation; that's fine.
      if (/ERR_ABORTED/.test(raw)) return;
      log(`Login: could not load roblox.com (${raw})`);
      // Don't leave the user staring at an error page.
      finish(new Error(describeNetError(err) ?? `Couldn't open the Roblox sign-in page (${raw}).`));
      if (!win.isDestroyed()) win.close();
    });
  });
}
