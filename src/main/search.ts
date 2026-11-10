// Game search. Roblox allows only one anonymous search a minute, so searches
// go through the active account's session, the same way roblox.com does it.
import { anonymousSearchTransport, searchGames, type SearchData, type SearchTransport } from "../core/robloxApi";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE } from "../shared/messages";
import type { GameSummary, StoredAccount } from "../shared/types";
import { activeAccount, clientFor } from "./accounts";
import { errorMessage, log } from "./logger";
import { usingFakeRoblox } from "./platform";

const anonymous = anonymousSearchTransport();
const signedIn = new Map<string, SearchTransport>();

function signedInTransport(account: StoredAccount): SearchTransport {
  let transport = signedIn.get(account.id);
  if (!transport) {
    transport = {
      signedIn: true,
      notBefore: 0,
      async get(url) {
        const res = await clientFor(account.partition).request({ method: "GET", url });
        log(`Search: signed in, HTTP ${res.status}`);
        if (res.status === 200) return { status: "ok", data: JSON.parse(res.body) as SearchData };
        if (res.status === 429) return { status: "limited", retryAfterMs: 5000 };
        return { status: "failed" };
      },
    };
    signedIn.set(account.id, transport);
  }
  return transport;
}

export async function searchRoblox(query: string): Promise<GameSummary[]> {
  const account = usingFakeRoblox() ? undefined : activeAccount();
  if (account) {
    try {
      const games = await searchGames(query, 24, signedInTransport(account));
      if (games) return games;
    } catch (err) {
      // A rate limit is a real answer. Anything else shouldn't stop the fallback below.
      if (errorMessage(err) === ROBLOX_BUSY) throw err;
      log(`Search: signed-in request failed (${errorMessage(err)})`);
    }
  }

  const games = await searchGames(query, 24, anonymous);
  if (!games) throw new Error(ROBLOX_UNREACHABLE);
  return games;
}
