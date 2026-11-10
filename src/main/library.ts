// Saves favorites and recently played games, and adds fresh art when showing them.
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addRecent, parseLibrary, setFavorite, type LibraryData } from "../core/library";
import { getGameDetails, getThumbnails } from "../core/robloxApi";
import type { GameSummary, Library, LibraryGame } from "../shared/types";
import { errorMessage, log } from "./logger";

const ART_BATCH = 50;

const libraryPath = () => path.join(app.getPath("userData"), "library.json");

function load(): LibraryData {
  try {
    return parseLibrary(JSON.parse(readFileSync(libraryPath(), "utf8")));
  } catch {
    // Missing or damaged: start empty.
    return parseLibrary(null);
  }
}

function save(data: LibraryData): void {
  writeFileSync(libraryPath(), JSON.stringify(data, null, 2));
}

export async function libraryView(data = load()): Promise<Library> {
  const universeIds = [...new Set([...data.recent, ...data.favorites].map((game) => game.universeId))];
  const groups: string[][] = [];
  for (let start = 0; start < universeIds.length; start += ART_BATCH) groups.push(universeIds.slice(start, start + ART_BATCH));

  const art = new Map((await Promise.all(groups.map((group) => getThumbnails(group)))).flatMap((found) => [...found]));
  const withArt = (game: LibraryGame): GameSummary => ({ ...game, thumbnailUrl: art.get(game.universeId) });
  return { recent: data.recent.map(withArt), favorites: data.favorites.map(withArt) };
}

export function setGameFavorite(game: LibraryGame, favorite: boolean): Promise<Library> {
  const next = setFavorite(load(), game, favorite);
  save(next);
  return libraryView(next);
}

/** Doesn't hold up the launch. Missing one entry in a list isn't worth making anyone wait. */
export function rememberLaunch(placeId: string): void {
  getGameDetails(placeId)
    .then((game) => {
      if (game) save(addRecent(load(), game));
    })
    .catch((err: unknown) => log(`Library: couldn't add that game to recents (${errorMessage(err)})`));
}
