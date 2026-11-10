// Makes authenticated Roblox requests for one account, from inside that
// account's own browser partition (see PLAN.md §5.3).
import { BrowserWindow, session, type Session } from "electron";
import pageScript from "virtual:roblox-session-page";
import { SESSION_ENDED } from "../shared/messages";
import type { HbaDiagnosis, LaunchResult } from "../shared/types";
import { errorMessage, log } from "./logger";
import { hardenSession, headerValue, lockToRoblox } from "./robloxWeb";

const WORLD_ID = 1337;
/** Any www.roblox.com page that carries the HBA metadata tag works. */
const SESSION_PAGE = "https://www.roblox.com/charts";
export const AUTH_TICKET_URL = "https://auth.roblox.com/v1/authentication-ticket/";

/** The hidden page only needs its HTML, so skipping these makes launches much faster. */
const SKIPPED_RESOURCES = new Set(["image", "media", "font", "stylesheet", "script", "subFrame", "object", "ping", "webSocket"]);
/** Close the hidden page after this long without use, to free its memory. */
const IDLE_CLOSE_MS = 120_000;

export interface PageRequest {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  exposeHeaders?: string[];
}

export interface PageResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  signed: boolean;
  notes: string[];
}

export interface TicketResult {
  ticket: string;
  via: LaunchResult["via"];
  signed: boolean;
  notes: string[];
}

export function getPageScript(): string {
  return pageScript;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class RobloxSessionClient {
  readonly ses: Session;
  private win: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private capturedTicket: string | null = null;
  private csrfToken: string | null = null;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(readonly partition: string) {
    this.ses = session.fromPartition(partition);
    hardenSession(this.ses);

    this.ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
      const fromSessionPage = !!this.win && !this.win.isDestroyed() && details.webContentsId === this.win.webContents.id;
      callback({ cancel: fromSessionPage && SKIPPED_RESOURCES.has(details.resourceType) });
    });

    // Roblox's CORS policy stops a page script from sending this header (the
    // preflight rejects it), so it is added at the network layer instead.
    this.ses.webRequest.onBeforeSendHeaders({ urls: [`${AUTH_TICKET_URL}*`] }, (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (details.method === "POST") requestHeaders.RBXAuthenticationNegotiation = "1";
      callback({ requestHeaders });
    });

    // Page scripts can't read these response headers either, but Electron can.
    // Any write on any Roblox host can be the one that hands out a new CSRF token.
    this.ses.webRequest.onHeadersReceived({ urls: ["https://*.roblox.com/*"] }, (details, callback) => {
      const ticket = headerValue(details.responseHeaders, "rbx-authentication-ticket");
      if (ticket) this.capturedTicket = ticket;
      const csrf = headerValue(details.responseHeaders, "x-csrf-token");
      if (csrf) this.csrfToken = csrf;
      callback({});
    });
  }

  private ensurePage(): Promise<void> {
    if (this.loading && this.win && !this.win.isDestroyed()) return this.loading;

    const win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: { partition: this.partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    lockToRoblox(win.webContents);
    win.webContents.setAudioMuted(true);
    this.win = win;
    this.loading = withTimeout(win.loadURL(SESSION_PAGE), 45_000, "Loading roblox.com timed out");
    this.loading.catch(() => this.dispose());
    return this.loading;
  }

  private async run<T>(expression: string): Promise<T> {
    await this.ensurePage();
    if (!this.win || this.win.isDestroyed()) throw new Error("Session page closed");
    // The script guards itself, so re-sending it is harmless and survives page reloads.
    const code = `${getPageScript()}\n;(${expression})`;
    try {
      return (await this.win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }], true)) as T;
    } finally {
      this.scheduleIdleClose();
    }
  }

  private scheduleIdleClose(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.dispose(), IDLE_CLOSE_MS);
    this.idleTimer.unref();
  }

  private attempt(req: PageRequest, csrfToken: string | null): Promise<PageResponse> {
    const payload = csrfToken ? { ...req, csrfToken } : req;
    return this.run<PageResponse>(`globalThis.__pusar.request(${JSON.stringify(payload)})`);
  }

  /** Includes Roblox's anti-forgery handshake: a write without a valid token gets 403 and a new token. */
  async request(req: PageRequest): Promise<PageResponse> {
    const tokenUsed = this.csrfToken;
    const first = await this.attempt(req, tokenUsed);
    if (first.status === 403 && this.csrfToken && this.csrfToken !== tokenUsed) {
      return this.attempt(req, this.csrfToken);
    }
    return first;
  }

  diagnose(): Promise<HbaDiagnosis> {
    return this.run<HbaDiagnosis>("globalThis.__pusar.diagnose()");
  }

  async hasSessionCookie(): Promise<boolean> {
    return (await this.readCookie()) !== null;
  }

  private async readCookie(): Promise<string | null> {
    const [cookie] = await this.ses.cookies.get({ url: "https://www.roblox.com", name: ".ROBLOSECURITY" });
    return cookie?.value ?? null;
  }

  /** Signed in-page request first; plain native request only as a fallback. */
  async getAuthTicket(): Promise<TicketResult> {
    const notes: string[] = [];
    this.capturedTicket = null;

    let res: PageResponse | null = null;
    try {
      res = await this.request({
        method: "POST",
        url: AUTH_TICKET_URL,
        body: {},
        exposeHeaders: ["rbx-authentication-ticket"],
      });
    } catch (err) {
      notes.push(`page request failed: ${errorMessage(err)}`);
    }

    if (res) {
      notes.push(`page request: HTTP ${res.status}, signed=${res.signed}`, ...res.notes);
      if (res.status === 401) throw new Error(SESSION_ENDED);
      const fromPage = res.headers["rbx-authentication-ticket"];
      if (fromPage) return { ticket: fromPage, via: "page", signed: res.signed, notes };
      if (this.capturedTicket) return { ticket: this.capturedTicket, via: "page-webRequest", signed: res.signed, notes };
      notes.push(`no ticket in response: ${res.body.slice(0, 200) || "(empty body)"}`);
    }

    log("Auth ticket: in-page request did not return a ticket, trying native fallback");
    const ticket = await nativeAuthTicket(await this.readCookie(), notes);
    return { ticket, via: "native", signed: false, notes };
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.loading = null;
  }
}

/** Unsigned request with the cookie. Works only while Roblox accepts unsigned requests. */
async function nativeAuthTicket(cookie: string | null, notes: string[]): Promise<string> {
  if (!cookie) throw new Error(SESSION_ENDED);
  const headers: Record<string, string> = {
    Cookie: `.ROBLOSECURITY=${cookie}`,
    Referer: "https://www.roblox.com/",
    Origin: "https://www.roblox.com",
    "Content-Type": "application/json",
    RBXAuthenticationNegotiation: "1",
  };
  const post = (extra: Record<string, string> = {}) =>
    fetch(AUTH_TICKET_URL, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });

  let res = await post();
  const csrf = res.headers.get("x-csrf-token");
  if (res.status === 403 && csrf) res = await post({ "X-CSRF-TOKEN": csrf });
  notes.push(`native request: HTTP ${res.status}`);
  if (res.status === 401) throw new Error(SESSION_ENDED);

  const ticket = res.headers.get("rbx-authentication-ticket");
  if (!ticket) throw new Error(`Roblox did not return an auth ticket (HTTP ${res.status}).`);
  return ticket;
}
