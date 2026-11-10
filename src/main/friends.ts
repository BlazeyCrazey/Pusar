// Friends of the active account, read through that account's own session.
import { loadOnlineFriends, type FriendsSession, type SessionReply } from "../core/friends";
import { getUserHeadshots } from "../core/robloxApi";
import type { FriendsResult } from "../shared/types";
import { activeAccount, clientFor } from "./accounts";
import { log } from "./logger";
import { usingFakeRoblox } from "./platform";
import { ensureRobloxReachable } from "./robloxWeb";

function noted(url: string, reply: SessionReply): SessionReply {
  if (reply.status !== 200) log(`Friends: ${new URL(url).hostname} replied HTTP ${reply.status}`);
  return reply;
}

export async function friendsOfActiveAccount(): Promise<FriendsResult> {
  const account = usingFakeRoblox() ? undefined : activeAccount();
  if (!account) return { signedIn: false, friends: [] };

  await ensureRobloxReachable();
  const client = clientFor(account.partition);
  const session: FriendsSession = {
    get: async (url) => noted(url, await client.request({ method: "GET", url })),
    post: async (url, body) => noted(url, await client.request({ method: "POST", url, body })),
  };
  return { signedIn: true, friends: await loadOnlineFriends(account.userId, session, getUserHeadshots) };
}
