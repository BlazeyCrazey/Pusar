import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getGameInfo, getUniverseId } from "../src/core/robloxApi";

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
