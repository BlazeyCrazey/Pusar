// Injected into a hidden www.roblox.com page (in an isolated world) inside an
// account's own browser partition. Making requests from here means:
//  - the session cookie is sent by the browser, never handled by Pusar code;
//  - requests can be signed with the device key Roblox stored in this
//    partition's IndexedDB at login (x-bound-auth-token), via roblox-bat.
import { HBAClient } from "roblox-bat";

interface PageRequest {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  csrfToken?: string;
  exposeHeaders?: string[];
}

interface PageResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  signed: boolean;
  notes: string[];
}

interface HbaDiagnosis {
  metadataFound: boolean;
  isAuthenticated?: boolean;
  secureAuthIntentEnabled?: boolean;
  batEnabledForAllUrls?: boolean;
  whitelistSites?: string[];
  exemptSites?: string[];
  hasKeyPair: boolean;
  error?: string;
}

interface PusarPage {
  request(req: PageRequest): Promise<PageResponse>;
  diagnose(): Promise<HbaDiagnosis>;
}

declare global {
  // eslint-disable-next-line no-var
  var __pusar: PusarPage | undefined;
}

if (!globalThis.__pusar) {
  const hba = new HBAClient({ onSite: true });

  globalThis.__pusar = {
    // One attempt only. The anti-forgery retry lives in the main process,
    // because Roblox doesn't expose that token to page scripts.
    async request(req) {
      const notes: string[] = [];
      const bodyText = req.body === undefined ? undefined : JSON.stringify(req.body);
      const headers: Record<string, string> = {};
      if (bodyText !== undefined) headers["Content-Type"] = "application/json";
      if (req.csrfToken) headers["x-csrf-token"] = req.csrfToken;

      let signed = false;
      try {
        const bat = await hba.generateBaseHeaders(req.url, req.method, true, bodyText);
        const token = (bat as Record<string, string>)["x-bound-auth-token"];
        if (token) {
          headers["x-bound-auth-token"] = token;
          signed = true;
        }
      } catch (err) {
        notes.push(`signing failed: ${String(err)}`);
      }

      try {
        const res = await fetch(req.url, { method: req.method, headers, body: bodyText, credentials: "include" });
        const exposed: Record<string, string> = {};
        for (const name of req.exposeHeaders ?? []) {
          const value = res.headers.get(name);
          if (value) exposed[name] = value;
        }
        const text = await res.text();
        return { status: res.status, headers: exposed, body: text.slice(0, 50_000), signed, notes };
      } catch (err) {
        notes.push(`fetch failed: ${String(err)}`);
        return { status: 0, headers: {}, body: "", signed, notes };
      }
    },

    async diagnose() {
      try {
        const meta = await hba.getTokenMetadata();
        let hasKeyPair = false;
        try {
          hasKeyPair = !!(await hba.getCryptoKeyPair())?.privateKey;
        } catch {
          hasKeyPair = false;
        }
        return {
          metadataFound: !!meta,
          isAuthenticated: meta?.isAuthenticated,
          secureAuthIntentEnabled: meta?.isSecureAuthenticationIntentEnabled,
          batEnabledForAllUrls: meta?.isBoundAuthTokenEnabledForAllUrls,
          whitelistSites: (meta?.boundAuthTokenWhitelist ?? []).map((w) => `${w.apiSite} (${w.sampleRate}%)`),
          exemptSites: (meta?.boundAuthTokenExemptlist ?? []).map((e) => e.apiSite),
          hasKeyPair,
        };
      } catch (err) {
        return { metadataFound: false, hasKeyPair: false, error: String(err) };
      }
    },
  };
}
