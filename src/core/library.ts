// Favorites and recently played games. Kept on this PC, so they work without an account.
import { z } from "zod";
import type { LibraryGame } from "../shared/types";

export interface LibraryData {
  recent: LibraryGame[];
  favorites: LibraryGame[];
}

export const MAX_RECENT = 24;
export const MAX_FAVORITES = 200;

const digits = z.string().regex(/^\d{1,20}$/);

export const libraryGameSchema = z.object({
  universeId: digits,
  placeId: digits,
  name: z.string().min(1).max(200),
  creatorName: z.string().max(200).optional(),
});

/** One damaged entry shouldn't cost someone the rest of their list. */
function validGames(raw: unknown): LibraryGame[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const game = libraryGameSchema.safeParse(entry);
    return game.success ? [game.data] : [];
  });
}

export function parseLibrary(raw: unknown): LibraryData {
  const data = (raw ?? {}) as { recent?: unknown; favorites?: unknown };
  return { recent: validGames(data.recent), favorites: validGames(data.favorites) };
}

const saved = ({ universeId, placeId, name, creatorName }: LibraryGame): LibraryGame =>
  creatorName ? { universeId, placeId, name, creatorName } : { universeId, placeId, name };

const without = (games: LibraryGame[], universeId: string) => games.filter((game) => game.universeId !== universeId);

export function addRecent(data: LibraryData, game: LibraryGame): LibraryData {
  return { ...data, recent: [saved(game), ...without(data.recent, game.universeId)].slice(0, MAX_RECENT) };
}

export function setFavorite(data: LibraryData, game: LibraryGame, favorite: boolean): LibraryData {
  const others = without(data.favorites, game.universeId);
  return { ...data, favorites: favorite ? [saved(game), ...others].slice(0, MAX_FAVORITES) : others };
}
