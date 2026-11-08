// Rules for what counts as Pusar's own page, and how its files are served.
// No Electron imports, so these security checks can be unit-tested.
import path from "node:path";

export const APP_SCHEME = "pusar";
export const APP_HOST = "app";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Inline scripts stay blocked. Inline styles are allowed only because the UI
 * library (Radix) injects small style tags, and CSS can't run code.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' https://*.rbxcdn.com",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** True for Pusar's own pages. `devUrl` is the Vite dev server, only when running from source. */
export function isAppUrl(raw: string, devUrl?: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST) return true;
  if (!devUrl) return false;
  try {
    return url.origin === new URL(devUrl).origin;
  } catch {
    return false;
  }
}

/** Maps a request path to a file inside `root`, or null if it would escape it. */
export function resolveAppFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const full = path.resolve(root, relative);
  const fromRoot = path.relative(root, full);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return full;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
