// Serves the UI from pusar://app/ instead of file://, so pages get a real
// origin, a Content Security Policy header, and no access to the file system.
import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import {
  APP_HOST,
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  contentTypeFor,
  resolveAppFile,
} from "../core/appUrl";

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ]);
}

export function installAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = url.host === APP_HOST ? resolveAppFile(rendererRoot, url.pathname) : null;
    if (!file) return new Response("Not found", { status: 404 });

    const response = await net.fetch(pathToFileURL(file).toString());
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": contentTypeFor(file),
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
