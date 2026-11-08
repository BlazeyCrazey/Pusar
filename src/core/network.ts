// Tells "roblox.com is blocked on this network" apart from other failures,
// so users get a clear message instead of a blank login window.
//
// The caller supplies the DNS lookup. In the app this MUST be Chromium's
// resolver (see main/robloxWeb.ts), the same one the login window uses, so
// the check and the real page load can never disagree. Node's own resolvers
// do not: c-ares only asks the Wi-Fi adapter's DNS server and ignores what a
// VPN does to name lookups, which falsely reported a block (2026-11-07).

export type Reachability =
  | { ok: true }
  | { ok: false; reason: "blocked" | "offline" | "error"; message: string };

export type LookupFn = (host: string) => Promise<Array<{ address: string }>>;

/** Addresses DNS filters hand out instead of the real one. */
const SINKHOLES = new Set(["0.0.0.0", "::", "127.0.0.1", "::1"]);

export const BLOCKED_MESSAGE =
  "Your network is blocking roblox.com (DNS answers 0.0.0.0), so signing in and launching can't work right now. " +
  "The official Roblox app is blocked too. This usually comes from a router, parental-control or ad-block filter, not Pusar.";

export const OFFLINE_MESSAGE =
  "Can't reach roblox.com. You may be offline, or your network may be blocking it.";

/** Node and Chromium error codes meaning "no usable answer" rather than a server failure. */
const NOT_FOUND_CODES = new Set([
  "ENOTFOUND",
  "ENOENT",
  "EAI_AGAIN",
  "ETIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_DNS_TIMED_OUT",
  "ERR_NETWORK_CHANGED",
]);

function errorCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code) return code;
  // Chromium errors carry the code in the message, e.g. "net::ERR_NAME_NOT_RESOLVED".
  return /ERR_[A-Z_]+/.exec(err instanceof Error ? err.message : String(err))?.[0];
}

export async function checkRobloxReachable(lookup: LookupFn): Promise<Reachability> {
  try {
    const addresses = await lookup("www.roblox.com");
    if (addresses.length === 0 || addresses.every((a) => SINKHOLES.has(a.address))) {
      return { ok: false, reason: "blocked", message: BLOCKED_MESSAGE };
    }
    return { ok: true };
  } catch (err) {
    const code = errorCode(err);
    if (code && NOT_FOUND_CODES.has(code)) {
      return { ok: false, reason: "offline", message: OFFLINE_MESSAGE };
    }
    return { ok: false, reason: "error", message: `Can't reach roblox.com (${code ?? String(err)}).` };
  }
}

export async function assertRobloxReachable(lookup: LookupFn): Promise<void> {
  const result = await checkRobloxReachable(lookup);
  if (!result.ok) throw new Error(result.message);
}

/** Maps Chromium network errors (from loadURL) to a readable message, or null if it isn't a network error. */
export function describeNetError(err: unknown): string | null {
  const text = err instanceof Error ? err.message : String(err);
  if (/ERR_ADDRESS_INVALID|ERR_ADDRESS_UNREACHABLE/.test(text)) return BLOCKED_MESSAGE;
  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_CONNECTION_(?:REFUSED|RESET|TIMED_OUT|CLOSED)|ERR_TIMED_OUT/.test(text)) {
    return OFFLINE_MESSAGE;
  }
  return null;
}
