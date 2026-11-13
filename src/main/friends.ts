// Friends of the active account, read through that account's own session.
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FriendsLoader, type FriendsSession, type SeenStore, type SessionReply } from "../core/friends";
import { getUserHeadshots } from "../core/robloxApi";
import type { FriendsResult } from "../shared/types";
import { activeAccount, clientFor } from "./accounts";
import { log } from "./logger";
import { usingFakeRoblox } from "./platform";
import { ensureRobloxReachable } from "./robloxWeb";

type SeenFile = Record<string, Record<string, number>>;

const seenPath = () => path.join(app.getPath("userData"), "friends-seen.json");

function readSeenFile(): SeenFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(seenPath(), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as SeenFile) : {};
  } catch {
    return {};
  }
}

/** When Pusar last saw each of one account's friends online. Stays on this PC. */
function seenStore(accountId: string): SeenStore {
  return {
    read() {
      const entries = Object.entries(readSeenFile()[accountId] ?? {});
      return new Map(entries.filter(([, at]) => Number.isFinite(at)).map(([id, at]) => [Number(id), at]));
    },
    record(userIds, at) {
      if (userIds.length === 0) return;
      const file = readSeenFile();
      const account = (file[accountId] ??= {});
      for (const id of userIds) account[id] = at;
      writeFileSync(seenPath(), JSON.stringify(file));
    },
  };
}

/** Removing an account removes what Pusar noted about its friends too. */
export function forgetFriends(accountId: string): void {
  loaders.delete(accountId);
  const file = readSeenFile();
  if (!(accountId in file)) return;
  delete file[accountId];
  writeFileSync(seenPath(), JSON.stringify(file));
}

function noted(url: string, reply: SessionReply): SessionReply {
  if (reply.status !== 200) log(`Friends: ${new URL(url).hostname} replied HTTP ${reply.status}`);
  return reply;
}

const loaders = new Map<string, FriendsLoader>();

export async function friendsOfActiveAccount(): Promise<FriendsResult> {
  const account = usingFakeRoblox() ? undefined : activeAccount();
  if (!account) return { signedIn: false, friends: [] };

  await ensureRobloxReachable();
  let loader = loaders.get(account.id);
  if (!loader) {
    const client = clientFor(account.partition);
    const session: FriendsSession = {
      get: async (url) => noted(url, await client.request({ method: "GET", url })),
      post: async (url, body) => noted(url, await client.request({ method: "POST", url, body })),
    };
    loader = new FriendsLoader(account.userId, session, getUserHeadshots, seenStore(account.id));
    loaders.set(account.id, loader);
  }
  return { signedIn: true, friends: await loader.load() };
}
