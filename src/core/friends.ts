// Every friend of an account: who's online and what they're playing first, then
// everyone else by when Pusar last saw them online.
//
// Roblox stopped sharing real last-online times (its last-online endpoint has
// returned made-up dates since it was deprecated), so Pusar remembers what it has
// seen itself. The friends endpoints are only trusted for IDs: Roblox says names
// come from the Users API and presence from the Presence API.
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

/** When Pusar last saw each friend online, kept between runs. */
export interface SeenStore {
  read(): Map<number, number>;
  record(userIds: number[], at: number): void;
}

export const UNREADABLE = "Roblox sent a friends list Pusar couldn't read.";

/** Roblox's own cap on friends. */
const MAX_FRIENDS = 1000;
/** Sizes every endpoint involved is known to accept. */
const FIND_PAGE = 50;
const PRESENCE_BATCH = 50;
const USERS_BATCH = 100;
const AVATAR_BATCH = 100;
/** Who someone's friends are changes rarely; who's online changes constantly. */
const FRIEND_LIST_TTL_MS = 10 * 60_000;

const idList = z.array(z.object({ id: z.number() }));
const findSchema = z
  .object({
    PageItems: idList.optional(),
    pageItems: idList.optional(),
    NextCursor: z.string().nullish(),
    nextCursor: z.string().nullish(),
  })
  .refine((page) => page.PageItems ?? page.pageItems, "no items");
const dataSchema = z.object({ data: idList });
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
const STATUS_ORDER: Record<FriendStatus, number> = { inGame: 0, studio: 1, online: 2, offline: 3 };
const JOB_ID = /^[0-9a-f-]{36}$/i;

/** Errors that say something about Roblox or the session, rather than about one endpoint. */
const SERIOUS = new Set([SESSION_ENDED, ROBLOX_BUSY, ROBLOX_UNREACHABLE]);

function readReply<T>(reply: SessionReply, schema: z.ZodType<T>): T {
  if (reply.status === 401) throw new Error(SESSION_ENDED);
  if (reply.status === 429) throw new Error(ROBLOX_BUSY);
  if (reply.status === 0 || reply.status >= 500) throw new Error(ROBLOX_UNREACHABLE);
  if (reply.status !== 200) throw new Error(UNREADABLE);
  try {
    return schema.parse(JSON.parse(reply.body));
  } catch {
    // Unlike a lost connection, this means Roblox changed something, so it should get noticed.
    throw new Error(UNREADABLE);
  }
}

function batches<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += size) groups.push(items.slice(start, start + size));
  return groups;
}

function presenceDetails(friend: FriendView, presence: Presence): void {
  // Friends' privacy settings decide whether Roblox shares any of this.
  if (presence.lastLocation) friend.gameName = presence.lastLocation;
  const placeId = presence.placeId ?? presence.rootPlaceId;
  if (friend.status === "inGame" && placeId && presence.gameId && JOB_ID.test(presence.gameId)) {
    friend.join = { placeId: String(placeId), jobId: presence.gameId };
  }
}

/** Online first, joinable games before others; then the most recently seen; then by name. */
export function compareFriends(a: FriendView, b: FriendView): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    Number(!!b.join) - Number(!!a.join) ||
    (b.lastSeen ?? 0) - (a.lastSeen ?? 0) ||
    a.displayName.localeCompare(b.displayName)
  );
}

/** One per account, so names, pictures and the friend list are fetched once and reused. */
export class FriendsLoader {
  private friendIds: { at: number; ids: number[] } | null = null;
  private readonly users = new Map<number, { name: string; displayName: string }>();
  private readonly avatars = new Map<number, string>();

  constructor(
    private readonly userId: number,
    private readonly session: FriendsSession,
    private readonly headshots: (userIds: number[]) => Promise<Map<number, string>>,
    private readonly seen: SeenStore,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<FriendView[]> {
    const [allIds, onlineIds] = await Promise.all([this.allFriendIds(), this.onlineFriendIds()]);
    const presences = (await this.presences(onlineIds)).filter((presence) => PRESENCE_STATUS[presence.userPresenceType]);
    this.seen.record(
      presences.map((presence) => presence.userId),
      this.now(),
    );

    // Someone added since the list was last fetched can already be online.
    const everyone = [...new Set([...presences.map((presence) => presence.userId), ...allIds])].slice(0, MAX_FRIENDS);
    await Promise.all([this.loadNames(everyone), this.loadAvatars(everyone)]);

    const presenceById = new Map(presences.map((presence) => [presence.userId, presence]));
    const lastSeen = this.seen.read();
    return everyone
      .flatMap((id) => {
        const user = this.users.get(id);
        if (!user) return [];
        const presence = presenceById.get(id);
        const status = presence ? (PRESENCE_STATUS[presence.userPresenceType] ?? "offline") : "offline";
        const friend: FriendView = { userId: id, username: user.name, displayName: user.displayName, status };
        const avatarUrl = this.avatars.get(id);
        if (avatarUrl) friend.avatarUrl = avatarUrl;
        if (presence && status !== "online") presenceDetails(friend, presence);
        const seenAt = lastSeen.get(id);
        if (status === "offline" && seenAt) friend.lastSeen = seenAt;
        return [friend];
      })
      .sort(compareFriends);
  }

  private async allFriendIds(): Promise<number[]> {
    if (this.friendIds && this.now() - this.friendIds.at < FRIEND_LIST_TTL_MS) return this.friendIds.ids;
    let ids: number[];
    try {
      ids = await this.pagedFriendIds();
    } catch (err) {
      if (err instanceof Error && SERIOUS.has(err.message)) throw err;
      // The older endpoint stops at 200 friends, but beats showing none.
      ids = readReply(await this.session.get(`https://friends.roblox.com/v1/users/${this.userId}/friends`), dataSchema).data.map(
        (friend) => friend.id,
      );
    }
    this.friendIds = { at: this.now(), ids };
    return ids;
  }

  private async pagedFriendIds(): Promise<number[]> {
    const ids: number[] = [];
    let cursor = "";
    while (ids.length < MAX_FRIENDS) {
      const params = new URLSearchParams({ limit: String(FIND_PAGE) });
      if (cursor) params.set("cursor", cursor);
      const page = readReply(
        await this.session.get(`https://friends.roblox.com/v1/users/${this.userId}/friends/find?${params.toString()}`),
        findSchema,
      );
      const items = page.PageItems ?? page.pageItems ?? [];
      ids.push(...items.map((item) => item.id));
      const next = page.NextCursor ?? page.nextCursor;
      if (!next || items.length === 0) break;
      cursor = next;
    }
    return ids.slice(0, MAX_FRIENDS);
  }

  private async onlineFriendIds(): Promise<number[]> {
    const reply = await this.session.get(`https://friends.roblox.com/v1/users/${this.userId}/friends/online`);
    return readReply(reply, dataSchema).data.map((friend) => friend.id);
  }

  private async presences(userIds: number[]): Promise<Presence[]> {
    const replies = await Promise.all(
      batches(userIds, PRESENCE_BATCH).map((group) => this.session.post("https://presence.roblox.com/v1/presence/users", { userIds: group })),
    );
    return replies.flatMap((reply) => readReply(reply, presenceSchema).userPresences);
  }

  private async loadNames(userIds: number[]): Promise<void> {
    const missing = userIds.filter((id) => !this.users.has(id));
    const replies = await Promise.all(
      batches(missing, USERS_BATCH).map((group) =>
        this.session.post("https://users.roblox.com/v1/users", { userIds: group, excludeBannedUsers: true }),
      ),
    );
    for (const user of replies.flatMap((reply) => readReply(reply, usersSchema).data)) {
      this.users.set(user.id, { name: user.name, displayName: user.displayName });
    }
  }

  /** Pictures are a nicety, and a failure shouldn't cost someone the whole list. */
  private async loadAvatars(userIds: number[]): Promise<void> {
    const missing = userIds.filter((id) => !this.avatars.has(id));
    const found = await Promise.all(batches(missing, AVATAR_BATCH).map((group) => this.headshots(group).catch(() => new Map<number, string>())));
    for (const [id, url] of found.flatMap((map) => [...map])) this.avatars.set(id, url);
  }
}
