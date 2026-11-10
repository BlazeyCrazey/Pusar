import { describe, expect, it, vi } from "vitest";
import { loadOnlineFriends, type FriendsSession, type SessionReply } from "../src/core/friends";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE, SESSION_ENDED } from "../src/shared/messages";

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

/** Answers like Roblox: the friends endpoint is only relied on for IDs. */
function fakeRoblox(presences: Presence[], overrides: Partial<Record<"friends" | "presence" | "users", SessionReply>> = {}) {
  const posts: Array<{ url: string; body: { userIds: number[] } }> = [];
  const session: FriendsSession = {
    get: vi.fn(async () => overrides.friends ?? ok({ data: presences.map((p) => ({ id: p.userId, name: "", displayName: "" })) })),
    post: vi.fn(async (url: string, body: unknown) => {
      const request = body as { userIds: number[] };
      posts.push({ url, body: request });
      if (url.includes("presence.roblox.com")) {
        return overrides.presence ?? ok({ userPresences: presences.filter((p) => request.userIds.includes(p.userId)) });
      }
      return overrides.users ?? ok({ data: request.userIds.map((id) => ({ id, name: `user${id}`, displayName: `Friend ${id}` })) });
    }),
  };
  return { session, posts };
}

const noAvatars = async () => new Map<number, string>();

describe("loadOnlineFriends", () => {
  it("asks only for that account's friends", async () => {
    const { session } = fakeRoblox([]);
    await loadOnlineFriends(4242, session, noAvatars);
    expect(session.get).toHaveBeenCalledWith("https://friends.roblox.com/v1/users/4242/friends/online");
  });

  it("makes no further requests when nobody is online", async () => {
    const { session } = fakeRoblox([]);
    expect(await loadOnlineFriends(1, session, noAvatars)).toEqual([]);
    expect(session.post).not.toHaveBeenCalled();
  });

  it("offers Join only when Roblox gives a place and server", async () => {
    const { session } = fakeRoblox([
      { userId: 1, userPresenceType: 2, lastLocation: "Tower Game", placeId: 100, gameId: JOB },
      { userId: 2, userPresenceType: 2, lastLocation: "Hidden", placeId: null, gameId: null },
    ]);
    const friends = await loadOnlineFriends(9, session, noAvatars);
    expect(friends[0]).toMatchObject({ userId: 1, status: "inGame", gameName: "Tower Game", join: { placeId: "100", jobId: JOB } });
    expect(friends[1]).toMatchObject({ userId: 2, status: "inGame", gameName: "Hidden" });
    expect(friends[1]?.join).toBeUndefined();
  });

  it("falls back to the root place when the exact place is missing", async () => {
    const { session } = fakeRoblox([{ userId: 1, userPresenceType: 2, placeId: null, rootPlaceId: 55, gameId: JOB }]);
    expect((await loadOnlineFriends(9, session, noAvatars))[0]?.join).toEqual({ placeId: "55", jobId: JOB });
  });

  it("won't offer a server ID that isn't one", async () => {
    const { session } = fakeRoblox([{ userId: 1, userPresenceType: 2, placeId: 100, gameId: "not-a-job&x=1" }]);
    expect((await loadOnlineFriends(9, session, noAvatars))[0]?.join).toBeUndefined();
  });

  it("doesn't treat the website as a game", async () => {
    const { session } = fakeRoblox([{ userId: 1, userPresenceType: 1, lastLocation: "Website", placeId: 100, gameId: JOB }]);
    const [friend] = await loadOnlineFriends(9, session, noAvatars);
    expect(friend?.status).toBe("online");
    expect(friend?.gameName).toBeUndefined();
    expect(friend?.join).toBeUndefined();
  });

  it("shows Studio without a Join button", async () => {
    const { session } = fakeRoblox([{ userId: 1, userPresenceType: 3, lastLocation: "My Place", placeId: 100, gameId: JOB }]);
    const [friend] = await loadOnlineFriends(9, session, noAvatars);
    expect(friend).toMatchObject({ status: "studio", gameName: "My Place" });
    expect(friend?.join).toBeUndefined();
  });

  it("drops anyone Roblox now reports as offline", async () => {
    const { session } = fakeRoblox([
      { userId: 1, userPresenceType: 0 },
      { userId: 2, userPresenceType: 1 },
    ]);
    expect((await loadOnlineFriends(9, session, noAvatars)).map((f) => f.userId)).toEqual([2]);
  });

  it("lists joinable games, then other games, then Studio, then online, by name", async () => {
    const { session } = fakeRoblox([
      { userId: 5, userPresenceType: 1 },
      { userId: 4, userPresenceType: 3 },
      { userId: 3, userPresenceType: 2 },
      { userId: 2, userPresenceType: 2, placeId: 7, gameId: JOB },
      { userId: 1, userPresenceType: 2, placeId: 7, gameId: JOB },
    ]);
    expect((await loadOnlineFriends(9, session, noAvatars)).map((f) => f.userId)).toEqual([1, 2, 3, 4, 5]);
  });

  it("splits big lists into requests Roblox accepts", async () => {
    const presences = Array.from({ length: 120 }, (_, i) => ({ userId: i + 1, userPresenceType: 1 }));
    const { session, posts } = fakeRoblox(presences);
    const friends = await loadOnlineFriends(9, session, noAvatars);
    expect(friends).toHaveLength(100);
    const presencePosts = posts.filter((p) => p.url.includes("presence"));
    expect(presencePosts).toHaveLength(2);
    expect(Math.max(...presencePosts.map((p) => p.body.userIds.length))).toBe(50);
  });

  it("adds avatars, and survives without them", async () => {
    const presence = [{ userId: 1, userPresenceType: 1 }];
    const withArt = async () => new Map([[1, "https://tr.rbxcdn.com/a.png"]]);
    expect((await loadOnlineFriends(9, fakeRoblox(presence).session, withArt))[0]?.avatarUrl).toBe("https://tr.rbxcdn.com/a.png");
    const failing = () => Promise.reject(new Error("nope"));
    expect((await loadOnlineFriends(9, fakeRoblox(presence).session, failing))[0]?.avatarUrl).toBeUndefined();
  });

  it("skips anyone the Users API doesn't return", async () => {
    const { session } = fakeRoblox(
      [
        { userId: 1, userPresenceType: 1 },
        { userId: 2, userPresenceType: 1 },
      ],
      { users: ok({ data: [{ id: 2, name: "two", displayName: "Two" }] }) },
    );
    expect((await loadOnlineFriends(9, session, noAvatars)).map((f) => f.userId)).toEqual([2]);
  });

  it.each([
    [401, SESSION_ENDED],
    [429, ROBLOX_BUSY],
    [500, ROBLOX_UNREACHABLE],
    [0, ROBLOX_UNREACHABLE],
  ])("explains HTTP %i", async (status, message) => {
    const { session } = fakeRoblox([], { friends: { status, body: "" } });
    await expect(loadOnlineFriends(9, session, noAvatars)).rejects.toThrow(message);
  });

  it("says so when Roblox changes the reply's shape, rather than showing nobody online", async () => {
    const { session } = fakeRoblox([{ userId: 1, userPresenceType: 1 }], { presence: ok({ somethingElse: [] }) });
    await expect(loadOnlineFriends(9, session, noAvatars)).rejects.toThrow(/couldn't read/);
  });

  it("handles a reply that isn't JSON", async () => {
    const { session } = fakeRoblox([], { friends: { status: 200, body: "<html>" } });
    await expect(loadOnlineFriends(9, session, noAvatars)).rejects.toThrow(/couldn't read/);
  });
});
