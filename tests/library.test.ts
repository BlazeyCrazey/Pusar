import { describe, expect, it } from "vitest";
import { addRecent, MAX_RECENT, parseLibrary, setFavorite, type LibraryData } from "../src/core/library";
import type { LibraryGame } from "../src/shared/types";

const game = (id: number, name = `Game ${id}`): LibraryGame => ({ universeId: String(id), placeId: String(id * 10), name });
const EMPTY: LibraryData = { recent: [], favorites: [] };

describe("recently played", () => {
  it("puts the latest game first", () => {
    const data = addRecent(addRecent(EMPTY, game(1)), game(2));
    expect(data.recent.map((g) => g.universeId)).toEqual(["2", "1"]);
  });

  it("moves a replayed game to the front instead of listing it twice", () => {
    const data = addRecent(addRecent(addRecent(EMPTY, game(1)), game(2)), game(1));
    expect(data.recent.map((g) => g.universeId)).toEqual(["1", "2"]);
  });

  it("keeps the place most recently launched in a universe", () => {
    const data = addRecent(addRecent(EMPTY, game(1)), { ...game(1), placeId: "777" });
    expect(data.recent).toHaveLength(1);
    expect(data.recent[0]?.placeId).toBe("777");
  });

  it("drops the oldest past the limit", () => {
    let data = EMPTY;
    for (let id = 1; id <= MAX_RECENT + 5; id++) data = addRecent(data, game(id));
    expect(data.recent).toHaveLength(MAX_RECENT);
    expect(data.recent[0]?.universeId).toBe(String(MAX_RECENT + 5));
    expect(data.recent.some((g) => g.universeId === "1")).toBe(false);
  });

  it("doesn't save art or player counts, which go stale", () => {
    const data = addRecent(EMPTY, { ...game(1), thumbnailUrl: "https://x/y.png", playing: 5 } as LibraryGame);
    expect(data.recent[0]).toEqual(game(1));
  });

  it("leaves favorites alone", () => {
    const data = addRecent({ recent: [], favorites: [game(9)] }, game(1));
    expect(data.favorites).toEqual([game(9)]);
  });
});

describe("favorites", () => {
  it("adds and removes a game", () => {
    const added = setFavorite(EMPTY, game(1), true);
    expect(added.favorites).toEqual([game(1)]);
    expect(setFavorite(added, game(1), false).favorites).toEqual([]);
  });

  it("doesn't list a game twice", () => {
    expect(setFavorite(setFavorite(EMPTY, game(1), true), game(1), true).favorites).toHaveLength(1);
  });

  it("removing something that isn't a favorite changes nothing", () => {
    expect(setFavorite(EMPTY, game(1), false).favorites).toEqual([]);
  });
});

describe("parseLibrary", () => {
  it("reads a saved library", () => {
    expect(parseLibrary({ recent: [game(1)], favorites: [game(2)] })).toEqual({ recent: [game(1)], favorites: [game(2)] });
  });

  it("keeps the good entries when one is damaged", () => {
    const data = parseLibrary({ recent: [game(1), { universeId: "x", placeId: "1", name: "Bad" }, null, 5], favorites: [] });
    expect(data.recent).toEqual([game(1)]);
  });

  it.each([null, undefined, 5, "nope", {}, { recent: "x", favorites: 3 }])("starts empty from %j", (raw) => {
    expect(parseLibrary(raw)).toEqual(EMPTY);
  });
});
