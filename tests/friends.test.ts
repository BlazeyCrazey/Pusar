import { describe, expect, it, vi } from "vitest";
import { compareFriends, FriendsLoader, UNREADABLE, type FriendsSession, type SeenStore, type SessionReply } from "../src/core/friends";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE, SESSION_ENDED } from "../src/shared/messages";
import type { FriendView } from "../src/shared/types";

const JOB = "11111111-2222-3333-4444-555555555555";
const ok = (data: unknown): SessionReply => ({ status: 200, body: JSON.stringify(data) });

interface Presence {
  userId: number;
  userPresenceType: number;
  lastLocation?: string | null;
  placeId?: number | null;
  rootPlaceId?: number | null;
  gameId?: string | null;
}

type Overrides = Partial<Record<"find" | "legacy" | "online" | "presence" | "users", SessionReply>>;

/** Answers like Roblox. `friends` is everyone; `presences` are the ones online right now. */
function fakeRoblox(friends: number[], presences: Presence[] = [], overrides: Overrides = {}) {
  const requests: string[] = [];
  const posts: Array<{ url: string; userIds: number[] }> = [];
  const session: FriendsSession = {
    get: vi.fn(async (url: string) => {
      requests.push(url);
      if (url.includes("/friends/online")) return overrides.online ?? ok({ data: presences.map((p) => ({ id: p.userId })) });
      if (url.includes("/friends/find")) {
        if (overrides.find) return overrides.find;
        const start = Number(new URL(url).searchParams.get("cursor") ?? 0);
        const page = friends.slice(start, start + 50);
        const next = start + 50 < friends.length ? String(start + 50) : null;
        return ok({ PageItems: page.map((id) => ({ id })), NextCursor: next });
      }
      return overrides.legacy ?? ok({ data: friends.slice(0, 200).map((id) => ({ id, name: "", displayName: "" })) });
    }),
    post: vi.fn(async (url: string, body: unknown) => {
      const { userIds } = body as { userIds: number[] };
      posts.push({ url, userIds });
      if (url.includes("presence.roblox.com")) {
        return overrides.presence ?? ok({ userPresences: presences.filter((p) => userIds.includes(p.userId)) });
      }
      return overrides.users ?? ok({ data: userIds.map((id) => ({ id, name: `user${id}`, displayName: `Friend ${id}` })) });
    }),
  };
  return { session, requests, posts };
}

function memorySeen(initial: Array<[number, number]> = []): SeenStore & { map: Map<number, number> } {
  const map = new Map(initial);
  return { map, read: () => new Map(map), record: (ids, at) => ids.forEach((id) => map.set(id, at)) };
}

const noAvatars = async () => new Map<number, string>();
const ids = (friends: FriendView[]) => friends.map((friend) => friend.userId);

function loader(
  roblox: ReturnType<typeof fakeRoblox>,
  seen = memorySeen(),
  now = () => 1_000_000,
  avatars: (userIds: number[]) => Promise<Map<number, string>> = noAvatars,
) {
  return new FriendsLoader(9, roblox.session, avatars, seen, now);
}

describe("the friends list", () => {
  it("shows everyone, online first, then offline", async () => {
    const roblox = fakeRoblox([1, 2, 3], [{ userId: 2, userPresenceType: 1 }]);
    const friends = await loader(roblox).load();
    expect(ids(friends)).toEqual([2, 1, 3]);
    expect(friends.map((friend) => friend.status)).toEqual(["online", "offline", "offline"]);
  });

  it("asks only for that account's friends", async () => {
    const roblox = fakeRoblox([]);
    await loader(roblox).load();
    expect(roblox.requests.every((url) => url.includes("/v1/users/9/"))).toBe(true);
  });

  it("orders offline friends by when Pusar last saw them, unseen ones last by name", async () => {
    const roblox = fakeRoblox([1, 2, 3, 4]);
    const seen = memorySeen([
      [3, 500],
      [1, 900],
    ]);
    const friends = await loader(roblox, seen).load();
    expect(ids(friends)).toEqual([1, 3, 2, 4]);
    expect(friends[0]?.lastSeen).toBe(900);
    expect(friends[2]?.lastSeen).toBeUndefined();
  });

  it("remembers who it saw online, and when", async () => {
    const roblox = fakeRoblox([1, 2], [{ userId: 2, userPresenceType: 2 }]);
    const seen = memorySeen();
    await loader(roblox, seen, () => 4242).load();
    expect([...seen.map]).toEqual([[2, 4242]]);
  });

  it("doesn't show a last-seen time for someone who's online now", async () => {
    const roblox = fakeRoblox([1], [{ userId: 1, userPresenceType: 1 }]);
    const friends = await loader(roblox, memorySeen([[1, 5]])).load();
    expect(friends[0]?.lastSeen).toBeUndefined();
  });

  it("includes someone online who was added after the list was fetched", async () => {
    const roblox = fakeRoblox([1], [{ userId: 77, userPresenceType: 1 }]);
    expect(ids(await loader(roblox).load())).toEqual([77, 1]);
  });

  it("pages through big friend lists", async () => {
    const everyone = Array.from({ length: 130 }, (_, i) => i + 1);
    const roblox = fakeRoblox(everyone);
    expect(await loader(roblox).load()).toHaveLength(130);
    expect(roblox.requests.filter((url) => url.includes("/friends/find"))).toHaveLength(3);
  });

  it("reuses the friend list, names and pictures, but checks who's online every time", async () => {
    const roblox = fakeRoblox([1, 2], [{ userId: 1, userPresenceType: 1 }]);
    let now = 0;
    const friends = loader(roblox, memorySeen(), () => now);
    await friends.load();
    now = 60_000;
    await friends.load();
    expect(roblox.requests.filter((url) => url.includes("/friends/find"))).toHaveLength(1);
    expect(roblox.requests.filter((url) => url.includes("/friends/online"))).toHaveLength(2);
    expect(roblox.posts.filter((post) => post.url.includes("users.roblox.com"))).toHaveLength(1);

    now = 11 * 60_000;
    await friends.load();
    expect(roblox.requests.filter((url) => url.includes("/friends/find"))).toHaveLength(2);
  });

  it("splits requests into sizes Roblox accepts", async () => {
    const everyone = Array.from({ length: 250 }, (_, i) => i + 1);
    const online = everyone.slice(0, 120).map((userId) => ({ userId, userPresenceType: 1 }));
    const roblox = fakeRoblox(everyone, online);
    const avatarCalls: number[][] = [];
    await loader(roblox, memorySeen(), () => 0, async (group) => (avatarCalls.push(group), new Map())).load();
    const sizes = (host: string) => roblox.posts.filter((post) => post.url.includes(host)).map((post) => post.userIds.length);
    expect(Math.max(...sizes("presence"))).toBe(50);
    expect(Math.max(...sizes("users.roblox.com"))).toBe(100);
    expect(Math.max(...avatarCalls.map((group) => group.length))).toBe(100);
  });

  it("adds pictures, and survives without them", async () => {
    const withArt = async () => new Map([[1, "https://tr.rbxcdn.com/a.png"]]);
    expect((await loader(fakeRoblox([1]), memorySeen(), () => 0, withArt).load())[0]?.avatarUrl).toBe("https://tr.rbxcdn.com/a.png");
    const failing = () => Promise.reject(new Error("nope"));
    expect((await loader(fakeRoblox([1]), memorySeen(), () => 0, failing).load())[0]?.avatarUrl).toBeUndefined();
  });

  it("skips anyone the Users API doesn't return", async () => {
    const roblox = fakeRoblox([1, 2], [], { users: ok({ data: [{ id: 2, name: "two", displayName: "Two" }] }) });
    expect(ids(await loader(roblox).load())).toEqual([2]);
  });
});

describe("what friends are doing", () => {
  it("offers Join only when Roblox gives a place and server", async () => {
    const roblox = fakeRoblox(
      [1, 2],
      [
        { userId: 1, userPresenceType: 2, lastLocation: "Tower Game", placeId: 100, gameId: JOB },
        { userId: 2, userPresenceType: 2, lastLocation: "Hidden", placeId: null, gameId: null },
      ],
    );
    const friends = await loader(roblox).load();
    expect(friends[0]).toMatchObject({ userId: 1, status: "inGame", gameName: "Tower Game", join: { placeId: "100", jobId: JOB } });
    expect(friends[1]).toMatchObject({ userId: 2, status: "inGame", gameName: "Hidden" });
    expect(friends[1]?.join).toBeUndefined();
  });

  it("falls back to the root place when the exact place is missing", async () => {
    const roblox = fakeRoblox([1], [{ userId: 1, userPresenceType: 2, placeId: null, rootPlaceId: 55, gameId: JOB }]);
    expect((await loader(roblox).load())[0]?.join).toEqual({ placeId: "55", jobId: JOB });
  });

  it("won't offer a server ID that isn't one", async () => {
    const roblox = fakeRoblox([1], [{ userId: 1, userPresenceType: 2, placeId: 100, gameId: "not-a-job&x=1" }]);
    expect((await loader(roblox).load())[0]?.join).toBeUndefined();
  });

  it("doesn't treat the website as a game", async () => {
    const roblox = fakeRoblox([1], [{ userId: 1, userPresenceType: 1, lastLocation: "Website", placeId: 100, gameId: JOB }]);
    const [friend] = await loader(roblox).load();
    expect(friend?.status).toBe("online");
    expect(friend?.gameName).toBeUndefined();
    expect(friend?.join).toBeUndefined();
  });

  it("shows Studio without a Join button", async () => {
    const roblox = fakeRoblox([1], [{ userId: 1, userPresenceType: 3, lastLocation: "My Place", placeId: 100, gameId: JOB }]);
    const [friend] = await loader(roblox).load();
    expect(friend).toMatchObject({ status: "studio", gameName: "My Place" });
    expect(friend?.join).toBeUndefined();
  });

  it("treats someone Roblox now reports as offline as offline", async () => {
    const roblox = fakeRoblox([1], [{ userId: 1, userPresenceType: 0 }]);
    expect((await loader(roblox).load())[0]?.status).toBe("offline");
  });
});

describe("when Roblox misbehaves", () => {
  it("falls back to the older friends endpoint if the paged one changes", async () => {
    const roblox = fakeRoblox([1, 2], [], { find: ok({ somethingElse: true }) });
    expect(ids(await loader(roblox).load())).toEqual([1, 2]);
    expect(roblox.requests.some((url) => /\/friends$/.test(url))).toBe(true);
  });

  it("doesn't paper over an ended session with the fallback", async () => {
    const roblox = fakeRoblox([1], [], { find: { status: 401, body: "" } });
    await expect(loader(roblox).load()).rejects.toThrow(SESSION_ENDED);
  });

  it.each([
    [401, SESSION_ENDED],
    [429, ROBLOX_BUSY],
    [500, ROBLOX_UNREACHABLE],
    [0, ROBLOX_UNREACHABLE],
  ])("explains HTTP %i", async (status, message) => {
    const roblox = fakeRoblox([1], [], { online: { status, body: "" } });
    await expect(loader(roblox).load()).rejects.toThrow(message);
  });

  it("says so when Roblox changes a reply's shape, rather than showing nobody", async () => {
    const roblox = fakeRoblox([1], [{ userId: 1, userPresenceType: 1 }], { presence: ok({ somethingElse: [] }) });
    await expect(loader(roblox).load()).rejects.toThrow(UNREADABLE);
  });

  it("handles a reply that isn't JSON", async () => {
    const roblox = fakeRoblox([1], [], { online: { status: 200, body: "<html>" } });
    await expect(loader(roblox).load()).rejects.toThrow(UNREADABLE);
  });
});

describe("compareFriends", () => {
  const friend = (userId: number, rest: Partial<FriendView>): FriendView => ({
    userId,
    username: `u${userId}`,
    displayName: `Name ${userId}`,
    status: "offline",
    ...rest,
  });

  it("puts joinable games, other games, Studio, online, then offline by last seen", () => {
    const list = [
      friend(1, { lastSeen: 10 }),
      friend(2, { status: "online" }),
      friend(3, { status: "studio" }),
      friend(4, { status: "inGame" }),
      friend(5, { status: "inGame", join: { placeId: "1", jobId: JOB } }),
      friend(6, { lastSeen: 20 }),
      friend(7, {}),
    ];
    expect(list.sort(compareFriends).map((f) => f.userId)).toEqual([5, 4, 3, 2, 6, 1, 7]);
  });
});
