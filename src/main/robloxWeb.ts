// Guards for windows that show roblox.com pages.
import { session, type Session, type WebContents } from "electron";
import { assertRobloxReachable, type LookupFn } from "../core/network";
import { log } from "./logger";

/**
 * DNS lookup through Chromium, the same resolver (and VPN/proxy handling)
 * the login window and session pages use. Cache is skipped so turning a
 * VPN on or off takes effect immediately.
 */
export const chromiumLookup: LookupFn = async (host) => {
  const result = await session.defaultSession.resolveHost(host, { cacheUsage: "disallowed" });
  return result.endpoints.map((endpoint) => ({ address: endpoint.address }));
};

export function ensureRobloxReachable(): Promise<void> {
  return assertRobloxReachable(chromiumLookup);
}

export function isRobloxUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "roblox.com" || url.hostname.endsWith(".roblox.com"));
  } catch {
    return false;
  }
}

/** Main-frame navigation and pop-ups may only go to https://*.roblox.com. */
export function lockToRoblox(contents: WebContents): void {
  const guard = (event: { preventDefault(): void }, url: string) => {
    if (!isRobloxUrl(url)) {
      event.preventDefault();
      log(`Blocked navigation away from roblox.com: ${new URL(url).origin}`);
    }
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler(({ url }) => {
    if (isRobloxUrl(url)) contents.loadURL(url);
    return { action: "deny" };
  });
}

/** Account sessions never get camera, mic, notifications, etc. */
export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

export function headerValue(headers: Record<string, string[] | string> | undefined, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }
  return null;
}
