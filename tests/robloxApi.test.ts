import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE } from "../src/shared/messages";
import { anonymousSearchTransport, getGameDetails, getGameInfo, getPopularGames, getUniverseId, getUserHeadshots, searchGames, type SearchTransport } from "../src/core/robloxApi";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// robloxApi caches by ID for the life of the app, so each test uses its own IDs.
describe("getUniverseId", () => {
  it("returns the universe as a string and caches it", async () => {
    const hit = vi.fn();
    server.use(
      http.get("https://apis.roblox.com/universes/v1/places/101/universe", () => {
        hit();
        return HttpResponse.json({ universeId: 5001 });
      }),
    );
    expect(await getUniverseId("101")).toBe("5001");
    expect(await getUniverseId("101")).toBe("5001");
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it("returns null on errors and doesn't cache the failure", async () => {
    server.use(http.get("https://apis.roblox.com/universes/v1/places/102/universe", () => new HttpResponse(null, { status: 500 })));
    expect(await getUniverseId("102")).toBeNull();

    server.use(http.get("https://apis.roblox.com/universes/v1/places/102/universe", () => HttpResponse.json({ universeId: 7 })));
    expect(await getUniverseId("102")).toBe("7");
  });

  it("returns null when the network fails", async () => {
    server.use(http.get("https://apis.roblox.com/universes/v1/places/103/universe", () => HttpResponse.error()));
    expect(await getUniverseId("103")).toBeNull();
  });
});

describe("getGameInfo", () => {
  const games = (id: string, body: unknown) =>
    http.get("https://games.roblox.com/v1/games", ({ request }) =>
      new URL(request.url).searchParams.get("universeIds") === id ? HttpResponse.json(body as object) : undefined,
    );
  const icons = (id: string, body: unknown) =>
    http.get("https://thumbnails.roblox.com/v1/games/icons", ({ request }) =>
      new URL(request.url).searchParams.get("universeIds") === id ? HttpResponse.json(body as object) : undefined,
    );

  it("combines the game details and icon", async () => {
    server.use(
      games("201", { data: [{ id: 201, name: "Crossroads", rootPlaceId: 1818, creator: { name: "Roblox" } }] }),
      icons("201", { data: [{ state: "Completed", imageUrl: "https://tr.rbxcdn.com/i.png" }] }),
    );
    expect(await getGameInfo("201")).toEqual({
      universeId: "201",
      name: "Crossroads",
      rootPlaceId: "1818",
      creatorName: "Roblox",
      iconUrl: "https://tr.rbxcdn.com/i.png",
    });
  });

  it("leaves out the icon until Roblox has finished moderating it", async () => {
    server.use(
      games("202", { data: [{ id: 202, name: "New Game" }] }),
      icons("202", { data: [{ state: "Pending", imageUrl: "https://tr.rbxcdn.com/placeholder.png" }] }),
    );
    expect((await getGameInfo("202"))?.iconUrl).toBeUndefined();
  });

  it("still returns the game if the icon lookup fails", async () => {
    server.use(
      games("203", { data: [{ id: 203, name: "No Icon" }] }),
      http.get("https://thumbnails.roblox.com/v1/games/icons", () => new HttpResponse(null, { status: 503 })),
    );
    expect((await getGameInfo("203"))?.name).toBe("No Icon");
  });

  it("returns null for an unknown game", async () => {
    server.use(games("204", { data: [] }), icons("204", { data: [] }));
    expect(await getGameInfo("204")).toBeNull();
  });
});

describe("browsing games", () => {
  const listing = (universeId: number, name: string, extra: object = {}) => ({
    universeId,
    rootPlaceId: universeId * 10,
    name,
    creatorName: "Maker",
    playerCount: 42,
    ...extra,
  });
  const noArt = http.get("https://thumbnails.roblox.com/v1/games/multiget/thumbnails", () => HttpResponse.json({ data: [] }));

  it("searches, flattens Roblox's groups, and hides sponsored and duplicate games", async () => {
    server.use(
      noArt,
      http.get("https://apis.roblox.com/search-api/omni-search", ({ request }) => {
        expect(new URL(request.url).searchParams.get("searchQuery")).toBe("tower");
        return HttpResponse.json({
          searchResults: [
            { contentGroupType: "Game", contents: [listing(1, "One")] },
            { contentGroupType: "Game", contents: [listing(2, "Ad", { isSponsored: true })] },
            { contentGroupType: "Game", contents: [listing(1, "One again")] },
            { contentGroupType: "Player", contents: [listing(3, "Not a game")] },
          ],
        });
      }),
    );
    expect(await searchGames("tower")).toEqual([
      { universeId: "1", placeId: "10", name: "One", creatorName: "Maker", playing: 42, thumbnailUrl: undefined },
    ]);
  });

  it("attaches artwork, skipping anything still in moderation", async () => {
    server.use(
      http.get("https://apis.roblox.com/search-api/omni-search", () =>
        HttpResponse.json({ searchResults: [{ contentGroupType: "Game", contents: [listing(5, "Ready"), listing(6, "Pending")] }] }),
      ),
      http.get("https://thumbnails.roblox.com/v1/games/multiget/thumbnails", ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get("universeIds")).toBe("5,6");
        expect(params.get("format")).toBe("Webp");
        return HttpResponse.json({
          data: [
            { universeId: 5, thumbnails: [{ state: "Completed", imageUrl: "https://tr.rbxcdn.com/a" }] },
            { universeId: 6, thumbnails: [{ state: "Pending", imageUrl: "https://tr.rbxcdn.com/b" }] },
          ],
        });
      }),
    );
    expect((await searchGames("x"))?.map((game) => game.thumbnailUrl)).toEqual(["https://tr.rbxcdn.com/a", undefined]);
  });

  it("tells a failed search apart from one with no matches", async () => {
    server.use(http.get("https://apis.roblox.com/search-api/omni-search", () => new HttpResponse(null, { status: 500 })));
    expect(await searchGames("a")).toBeNull();

    server.use(http.get("https://apis.roblox.com/search-api/omni-search", () => HttpResponse.json({ searchResults: [] })), noArt);
    expect(await searchGames("a")).toEqual([]);
  });

  it("prefers the top-playing list for popular games", async () => {
    server.use(
      noArt,
      http.get("https://apis.roblox.com/explore-api/v1/get-sorts", () =>
        HttpResponse.json({
          sorts: [
            { sortId: "filters", games: [] },
            { sortId: "top-trending", games: [listing(7, "Trending")] },
            { sortId: "top-playing-now", games: [listing(8, "Playing")] },
          ],
        }),
      ),
    );
    expect((await getPopularGames())?.map((game) => game.name)).toEqual(["Playing"]);
  });

  it("falls back to the first list with games if Roblox renames it", async () => {
    server.use(
      noArt,
      http.get("https://apis.roblox.com/explore-api/v1/get-sorts", () =>
        HttpResponse.json({ sorts: [{ sortId: "filters", games: [] }, { sortId: "renamed", games: [listing(9, "Fallback")] }] }),
      ),
    );
    expect((await getPopularGames())?.map((game) => game.name)).toEqual(["Fallback"]);
  });

  it("builds a game's details, keeping the place that was asked for", async () => {
    server.use(
      http.get("https://apis.roblox.com/universes/v1/places/301/universe", () => HttpResponse.json({ universeId: 3001 })),
      http.get("https://games.roblox.com/v1/games", () =>
        HttpResponse.json({ data: [{ name: "Detail", description: "Words", creator: { name: "Maker" }, playing: 9, visits: 100, maxPlayers: 30 }] }),
      ),
      http.get("https://thumbnails.roblox.com/v1/games/multiget/thumbnails", ({ request }) => {
        expect(new URL(request.url).searchParams.get("size")).toBe("768x432");
        return HttpResponse.json({ data: [{ universeId: 3001, thumbnails: [{ state: "Completed", imageUrl: "https://tr.rbxcdn.com/h" }] }] });
      }),
    );
    expect(await getGameDetails("301")).toEqual({
      universeId: "3001",
      placeId: "301",
      name: "Detail",
      creatorName: "Maker",
      playing: 9,
      thumbnailUrl: "https://tr.rbxcdn.com/h",
      description: "Words",
      visits: 100,
      maxPlayers: 30,
    });
  });

  it("returns null for a place Roblox doesn't know", async () => {
    server.use(http.get("https://apis.roblox.com/universes/v1/places/302/universe", () => new HttpResponse(null, { status: 404 })));
    expect(await getGameDetails("302")).toBeNull();
  });

  it("maps avatars by user and doesn't call the API for nobody", async () => {
    expect((await getUserHeadshots([])).size).toBe(0);
    server.use(
      http.get("https://thumbnails.roblox.com/v1/users/avatar-headshot", () =>
        HttpResponse.json({
          data: [
            { targetId: 1, state: "Completed", imageUrl: "https://tr.rbxcdn.com/u1" },
            { targetId: 2, state: "Blocked", imageUrl: "https://tr.rbxcdn.com/u2" },
          ],
        }),
      ),
    );
    expect([...(await getUserHeadshots([1, 2]))]).toEqual([[1, "https://tr.rbxcdn.com/u1"]]);
  });
});

describe("telling a lost connection from a missing game", () => {
  const universe = (id: number) => HttpResponse.json({ universeId: id });
  const noArt = http.get("https://thumbnails.roblox.com/v1/games/multiget/thumbnails", () => HttpResponse.json({ data: [] }));
  const places = "https://apis.roblox.com/universes/v1/places";

  it("blames the connection when the network fails", async () => {
    server.use(http.get(`${places}/401/universe`, () => HttpResponse.error()));
    await expect(getGameDetails("401")).rejects.toThrow(ROBLOX_UNREACHABLE);
  });

  it.each([500, 503])("blames the connection on HTTP %i", async (status) => {
    server.use(http.get(`${places}/40${status}/universe`, () => new HttpResponse(null, { status })));
    await expect(getGameDetails(`40${status}`)).rejects.toThrow(ROBLOX_UNREACHABLE);
  });

  it("blames the connection when the second lookup fails", async () => {
    server.use(
      noArt,
      http.get(`${places}/402/universe`, () => universe(4002)),
      http.get("https://games.roblox.com/v1/games", () => HttpResponse.error()),
    );
    await expect(getGameDetails("402")).rejects.toThrow(ROBLOX_UNREACHABLE);
  });

  it.each([
    ["HTTP 404", () => new HttpResponse(null, { status: 404 })],
    ["HTTP 400", () => new HttpResponse(null, { status: 400 })],
    ["no universe in the reply", () => HttpResponse.json({})],
  ])("reports a missing game for %s", async (label, reply) => {
    const placeId = `41${label.length}`;
    server.use(http.get(`${places}/${placeId}/universe`, reply));
    await expect(getGameDetails(placeId)).resolves.toBeNull();
  });

  it("reports a missing game when Roblox has no details for it", async () => {
    server.use(
      noArt,
      http.get(`${places}/403/universe`, () => universe(4003)),
      http.get("https://games.roblox.com/v1/games", () => HttpResponse.json({ data: [] })),
    );
    await expect(getGameDetails("403")).resolves.toBeNull();
  });

  it("doesn't remember a failed lookup", async () => {
    server.use(http.get(`${places}/404/universe`, () => HttpResponse.error()));
    await expect(getGameDetails("404")).rejects.toThrow();
    server.use(
      noArt,
      http.get(`${places}/404/universe`, () => universe(4004)),
      http.get("https://games.roblox.com/v1/games", () => HttpResponse.json({ data: [{ name: "Back again" }] })),
    );
    expect((await getGameDetails("404"))?.name).toBe("Back again");
  });
});

describe("Roblox's rate limit", () => {
  const SEARCH = "https://apis.roblox.com/search-api/omni-search";
  const noArt = http.get("https://thumbnails.roblox.com/v1/games/multiget/thumbnails", () => HttpResponse.json({ data: [] }));
  const found = (name: string) =>
    HttpResponse.json({ searchResults: [{ contentGroupType: "Game", contents: [{ universeId: 1, rootPlaceId: 2, name }] }] });
  const limited = (seconds: string) => new HttpResponse(null, { status: 429, headers: { "retry-after": seconds } });

  it("waits and retries instead of failing", async () => {
    let calls = 0;
    server.use(noArt, http.get(SEARCH, () => (++calls === 1 ? limited("0") : found("Second try"))));
    expect((await searchGames("retry me"))?.map((game) => game.name)).toEqual(["Second try"]);
    expect(calls).toBe(2);
  });

  it("gives up with a message that doesn't blame the connection", async () => {
    let calls = 0;
    server.use(http.get(SEARCH, () => (calls++, limited("0"))));
    await expect(searchGames("always limited")).rejects.toThrow(ROBLOX_BUSY);
    expect(calls).toBe(3);
  });

  it("respects how long Roblox asks it to wait", async () => {
    let calls = 0;
    server.use(noArt, http.get(SEARCH, () => (++calls === 1 ? limited("1") : found("Later"))));
    const started = Date.now();
    await searchGames("wait for it");
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it("drops a waiting search once a newer one starts", async () => {
    const asked: Array<string | null> = [];
    server.use(
      noArt,
      http.get(SEARCH, ({ request }) => {
        const query = new URL(request.url).searchParams.get("searchQuery");
        asked.push(query);
        return query === "old" ? limited("1") : found("New");
      }),
    );
    const old = searchGames("old");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const latest = await searchGames("new");
    expect(await old).toEqual([]);
    expect(latest?.map((game) => game.name)).toEqual(["New"]);
    expect(asked).toEqual(["old", "new"]);
  });

  it("reuses recent results instead of asking again", async () => {
    let calls = 0;
    server.use(noArt, http.get(SEARCH, () => (calls++, found("Cached"))));
    await searchGames("repeat");
    await searchGames("repeat");
    expect(calls).toBe(1);
  });

  it("doesn't remember a failed search", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.error()));
    expect(await searchGames("flaky")).toBeNull();
    server.use(noArt, http.get(SEARCH, () => found("Works now")));
    expect((await searchGames("flaky"))?.map((game) => game.name)).toEqual(["Works now"]);
  });

  it("tells a rate limit apart from a lost connection for game details too", async () => {
    server.use(http.get("https://apis.roblox.com/universes/v1/places/429429/universe", () => limited("5")));
    await expect(getGameDetails("429429")).rejects.toThrow(ROBLOX_BUSY);
  });
});

describe("the one-search-a-minute limit", () => {
  const SEARCH = "https://apis.roblox.com/search-api/omni-search";
  const noArt = http.get("https://thumbnails.roblox.com/v1/games/multiget/thumbnails", () => HttpResponse.json({ data: [] }));
  // The exact headers Roblox sent when measured on 2026-11-09.
  const allowance = (reset: string) => ({ "x-ratelimit-limit": "1, 1;w=60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset });
  const found = { searchResults: [{ contentGroupType: "Game", contents: [{ universeId: 1, rootPlaceId: 2, name: "Game" }] }] };

  it("uses the real reset time instead of the short Retry-After, and explains it", async () => {
    let calls = 0;
    server.use(http.get(SEARCH, () => (calls++, new HttpResponse(null, { status: 429, headers: { "retry-after": "5", ...allowance("43") } }))));
    const transport = anonymousSearchTransport();
    await expect(searchGames("minute one", 24, transport)).rejects.toThrow(/one search a minute.*4[23] seconds.*add an account/);
    expect(calls).toBe(1);
  });

  it("knows the allowance is spent after a success, and doesn't waste a request finding out", async () => {
    let calls = 0;
    server.use(noArt, http.get(SEARCH, () => (calls++, HttpResponse.json(found, { headers: allowance("30") }))));
    const transport = anonymousSearchTransport();
    expect(await searchGames("spent first", 24, transport)).toHaveLength(1);
    await expect(searchGames("spent second", 24, transport)).rejects.toThrow(/one search a minute/);
    expect(calls).toBe(1);
  });

  it("still answers a repeated search from memory while limited", async () => {
    server.use(noArt, http.get(SEARCH, () => HttpResponse.json(found, { headers: allowance("30") })));
    const transport = anonymousSearchTransport();
    await searchGames("remembered", 24, transport);
    expect(await searchGames("remembered", 24, transport)).toHaveLength(1);
  });

  it("keeps a signed-in session's limit separate from the anonymous one", async () => {
    const anonymous = anonymousSearchTransport();
    anonymous.notBefore = Date.now() + 40_000;
    const signedIn: SearchTransport = {
      signedIn: true,
      notBefore: 0,
      get: async () => ({ status: "ok", data: found }),
    };
    server.use(noArt);
    expect(await searchGames("separate limits", 24, signedIn)).toHaveLength(1);
  });

  it("doesn't blame the account limit on a signed-in session", async () => {
    const signedIn: SearchTransport = {
      signedIn: true,
      notBefore: Date.now() + 30_000,
      get: async () => ({ status: "ok", data: found }),
    };
    await expect(searchGames("signed in limited", 24, signedIn)).rejects.toThrow(ROBLOX_BUSY);
  });
});
