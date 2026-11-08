// App-wide security rules (PLAN.md §4).
import { app, session, type IpcMainInvokeEvent } from "electron";
import { isAppUrl } from "../core/appUrl";

/** The Vite dev server URL. A packaged app never honours this variable. */
export function devRendererUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
}

export function isOwnPage(url: string): boolean {
  return isAppUrl(url, devRendererUrl());
}

/** IPC is only accepted from the top frame of Pusar's own page. */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return !!frame && frame.parent === null && isOwnPage(frame.url);
}

export function installSecurityPolicy(): void {
  // Every new page starts with no pop-ups and no <webview>.
  // Windows that need different rules set them after creation (see robloxWeb.ts).
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (attachEvent) => attachEvent.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  // Pusar's own page needs clipboard writing for "copy" buttons and nothing else.
  const CLIPBOARD_WRITE = "clipboard-sanitized-write";
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === CLIPBOARD_WRITE && isOwnPage(contents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    return permission === CLIPBOARD_WRITE && !!contents && isOwnPage(contents.getURL());
  });
}
