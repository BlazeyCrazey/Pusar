// Public (no login) Roblox web API lookups used for presence and the library.

import type { GameInfo } from "../shared/types";

export type { GameInfo };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const universeCache = new Map<string, string>();
const gameCache = new Map<string, GameInfo>();

export async function getUniverseId(placeId: string): Promise<string | null> {
  const cached = universeCache.get(placeId);
  if (cached) return cached;
  const data = await getJson<{ universeId?: number }>(
    `https://apis.roblox.com/universes/v1/places/${encodeURIComponent(placeId)}/universe`,
  );
  if (!data?.universeId) return null;
  const id = String(data.universeId);
  universeCache.set(placeId, id);
  return id;
}

export async function getGameInfo(universeId: string): Promise<GameInfo | null> {
  const cached = gameCache.get(universeId);
  if (cached) return cached;

  const id = encodeURIComponent(universeId);
  const [games, icons] = await Promise.all([
    getJson<{ data?: Array<{ id: number; name: string; rootPlaceId?: number; creator?: { name?: string } }> }>(
      `https://games.roblox.com/v1/games?universeIds=${id}`,
    ),
    getJson<{ data?: Array<{ state?: string; imageUrl?: string }> }>(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${id}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`,
    ),
  ]);

  const game = games?.data?.[0];
  if (!game) return null;
  const icon = icons?.data?.[0];
  const info: GameInfo = {
    universeId,
    name: game.name,
    rootPlaceId: game.rootPlaceId ? String(game.rootPlaceId) : undefined,
    creatorName: game.creator?.name,
    iconUrl: icon?.state === "Completed" ? icon.imageUrl : undefined,
  };
  gameCache.set(universeId, info);
  return info;
}
