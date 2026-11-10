// Which of an account's friends are online, and what they're playing.
//
// Roblox has been emptying the presence and name fields on its friends endpoints
// and points developers to the Presence and Users APIs instead, so the friends
// endpoint is only trusted for IDs.
import { z } from "zod";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE, SESSION_ENDED } from "../shared/messages";
import type { FriendStatus, FriendView } from "../shared/types";

export interface SessionReply {
  status: number;
  body: string;
}

/** How friend lookups reach Roblox: from inside the account's own session. */
export interface FriendsSession {
  get(url: string): Promise<SessionReply>;
  post(url: string, body: unknown): Promise<SessionReply>;
}

/** Sizes every endpoint involved is known to accept. */
const PRESENCE_BATCH = 50;
const USERS_BATCH = 100;
const MAX_FRIENDS_SHOWN = 100;

const onlineSchema = z.object({ data: z.array(z.object({ id: z.number() })) });
const presenceSchema = z.object({
  userPresences: z.array(
    z.object({
      userId: z.number(),
      userPresenceType: z.number(),
      lastLocation: z.string().nullish(),
      placeId: z.number().nullish(),
      rootPlaceId: z.number().nullish(),
      gameId: z.string().nullish(),
    }),
  ),
});
const usersSchema = z.object({ data: z.array(z.object({ id: z.number(), name: z.string(), displayName: z.string() })) });

type Presence = z.infer<typeof presenceSchema>["userPresences"][number];

const PRESENCE_STATUS: Record<number, FriendStatus> = { 1: "online", 2: "inGame", 3: "studio" };
const STATUS_ORDER: Record<FriendStatus, number> = { inGame: 0, studio: 1, online: 2 };
const JOB_ID = /^[0-9a-f-]{36}$/i;

function readReply<T>(reply: SessionReply, schema: z.ZodType<T>): T {
  if (reply.status === 401) throw new Error(SESSION_ENDED);
  if (reply.status === 429) throw new Error(ROBLOX_BUSY);
  if (reply.status !== 200) throw new Error(ROBLOX_UNREACHABLE);
  try {
    return schema.parse(JSON.parse(reply.body));
  } catch {
    // Unlike a lost connection, this means Roblox changed something, so it should get noticed.
    throw new Error("Roblox sent a friends list Pusar couldn't read.");
  }
}

function batches<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += size) groups.push(items.slice(start, start + size));
  return groups;
}

function toFriend(
  presence: Presence,
  status: FriendStatus,
  user: { name: string; displayName: string },
  avatarUrl: string | undefined,
): FriendView {
  const friend: FriendView = { userId: presence.userId, username: user.name, displayName: user.displayName, status };
  if (avatarUrl) friend.avatarUrl = avatarUrl;
  if (status === "online") return friend;

  // Friends' privacy settings decide whether Roblox shares any of this.
  if (presence.lastLocation) friend.gameName = presence.lastLocation;
  const placeId = presence.placeId ?? presence.rootPlaceId;
  if (status === "inGame" && placeId && presence.gameId && JOB_ID.test(presence.gameId)) {
    friend.join = { placeId: String(placeId), jobId: presence.gameId };
  }
  return friend;
}

const byActivityThenName = (a: FriendView, b: FriendView) =>
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
  Number(!!b.join) - Number(!!a.join) ||
  a.displayName.localeCompare(b.displayName);

export async function loadOnlineFriends(
  userId: number,
  session: FriendsSession,
  headshots: (userIds: number[]) => Promise<Map<number, string>>,
): Promise<FriendView[]> {
  const online = readReply(await session.get(`https://friends.roblox.com/v1/users/${userId}/friends/online`), onlineSchema);
  const ids = online.data.map((friend) => friend.id).slice(0, MAX_FRIENDS_SHOWN);
  if (ids.length === 0) return [];

  const presenceReplies = await Promise.all(
    batches(ids, PRESENCE_BATCH).map((userIds) => session.post("https://presence.roblox.com/v1/presence/users", { userIds })),
  );
  const presences = presenceReplies
    .flatMap((reply) => readReply(reply, presenceSchema).userPresences)
    .filter((presence) => PRESENCE_STATUS[presence.userPresenceType]);
  if (presences.length === 0) return [];

  const presentIds = presences.map((presence) => presence.userId);
  const [userReplies, avatars] = await Promise.all([
    Promise.all(
      batches(presentIds, USERS_BATCH).map((userIds) =>
        session.post("https://users.roblox.com/v1/users", { userIds, excludeBannedUsers: true }),
      ),
    ),
    // Pictures are a nicety, and shouldn't cost someone the whole list.
    headshots(presentIds).catch(() => new Map<number, string>()),
  ]);
  const users = new Map(userReplies.flatMap((reply) => readReply(reply, usersSchema).data).map((user) => [user.id, user]));

  return presences
    .flatMap((presence) => {
      const user = users.get(presence.userId);
      const status = PRESENCE_STATUS[presence.userPresenceType];
      return user && status ? [toFriend(presence, status, user, avatars.get(presence.userId))] : [];
    })
    .sort(byActivityThenName);
}
