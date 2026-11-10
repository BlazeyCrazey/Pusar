// Public (no login) Roblox web API lookups used for presence and game browsing.
import { randomUUID } from "node:crypto";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE } from "../shared/messages";
import type { GameDetails, GameInfo, GameSummary } from "../shared/types";

export type { GameInfo };

export type Fetched<T> =
  /** cooldownMs is set when that request used up the allowance. */
  | { status: "ok"; data: T; cooldownMs?: number }
  | { status: "missing" }
  | { status: "failed" }
  | { status: "limited"; retryAfterMs: number };

const DEFAULT_RETRY_AFTER_MS = 5000;
const MAX_RETRY_AFTER_MS = 90_000;

function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (header === null || !Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/** How long until the allowance refills, when it's used up. Retry-After alone can be far too short. */
function cooldownMs(headers: Headers): number | undefined {
  if (headers.get("x-ratelimit-remaining") !== "0") return undefined;
  const seconds = Number(headers.get("x-ratelimit-reset"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined;
}

const unavailableMessage = (status: "failed" | "limited") => (status === "limited" ? ROBLOX_BUSY : ROBLOX_UNREACHABLE);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson<T>(url: string): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { status: "ok", data: (await res.json()) as T, cooldownMs: cooldownMs(res.headers) };
    if (res.status === 429) {
      return { status: "limited", retryAfterMs: Math.max(retryAfterMs(res.headers.get("retry-after")), cooldownMs(res.headers) ?? 0) };
    }
    // Server errors say nothing about whether the thing exists.
    return res.status < 500 ? { status: "missing" } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  const result = await fetchJson<T>(url);
  return result.status === "ok" ? result.data : null;
}

const universeCache = new Map<string, string>();
const gameCache = new Map<string, GameInfo>();

async function lookUpUniverse(placeId: string): Promise<Fetched<string>> {
  const cached = universeCache.get(placeId);
  if (cached) return { status: "ok", data: cached };
  const result = await fetchJson<{ universeId?: number }>(
    `https://apis.roblox.com/universes/v1/places/${encodeURIComponent(placeId)}/universe`,
  );
  if (result.status !== "ok") return result;
  if (!result.data.universeId) return { status: "missing" };
  const id = String(result.data.universeId);
  universeCache.set(placeId, id);
  return { status: "ok", data: id };
}

export async function getUniverseId(placeId: string): Promise<string | null> {
  const result = await lookUpUniverse(placeId);
  return result.status === "ok" ? result.data : null;
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

/** Roblox only serves fixed sizes. WebP loads much faster than PNG. */
const HERO_ART_SIZE = "768x432";
const TILE_ART_SIZE = "480x270";

/** A game as Roblox's search and explore lists describe it. */
export interface GameListing {
  universeId: number;
  rootPlaceId: number;
  name: string;
  creatorName?: string;
  playerCount?: number;
  isSponsored?: boolean;
}

export async function getThumbnails(universeIds: string[], size = TILE_ART_SIZE): Promise<Map<string, string>> {
  const thumbnails = new Map<string, string>();
  if (universeIds.length === 0) return thumbnails;
  const ids = universeIds.map(encodeURIComponent).join(",");
  const data = await getJson<{
    data?: Array<{ universeId: number; thumbnails?: Array<{ state?: string; imageUrl?: string }> }>;
  }>(
    `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids}&countPerUniverse=1&defaults=true&size=${size}&format=Webp&isCircular=false`,
  );
  for (const item of data?.data ?? []) {
    const thumbnail = item.thumbnails?.[0];
    if (thumbnail?.state === "Completed" && thumbnail.imageUrl) {
      thumbnails.set(String(item.universeId), thumbnail.imageUrl);
    }
  }
  return thumbnails;
}

async function toSummaries(listings: GameListing[], limit: number): Promise<GameSummary[]> {
  const seen = new Set<number>();
  const games = listings
    .filter((game) => {
      if (game.isSponsored || seen.has(game.universeId)) return false;
      seen.add(game.universeId);
      return true;
    })
    .slice(0, limit);

  const thumbnails = await getThumbnails(games.map((game) => String(game.universeId)));
  return games.map((game) => ({
    universeId: String(game.universeId),
    placeId: String(game.rootPlaceId),
    name: game.name,
    creatorName: game.creatorName || undefined,
    playing: game.playerCount,
    thumbnailUrl: thumbnails.get(String(game.universeId)),
  }));
}

const SEARCH_ATTEMPTS = 3;
const SEARCH_CACHE_MS = 60_000;
const SEARCH_CACHE_SIZE = 50;

/** Longer than this, it's better to say so than leave someone staring at a spinner. */
const MAX_SEARCH_WAIT_MS = 8000;

export interface SearchData {
  searchResults?: Array<{ contentGroupType?: string; contents?: GameListing[] }>;
}

/** How a search reaches Roblox. Each one tracks its own rate limit. */
export interface SearchTransport {
  signedIn: boolean;
  notBefore: number;
  get(url: string): Promise<Fetched<SearchData>>;
}

/** Roblox allows only one of these per minute, measured 2026-11-09. */
export function anonymousSearchTransport(): SearchTransport {
  return { signedIn: false, notBefore: 0, get: (url) => fetchJson<SearchData>(url) };
}

function searchLimitMessage(transport: SearchTransport, waitMs: number): string {
  if (transport.signedIn || waitMs <= MAX_SEARCH_WAIT_MS) return ROBLOX_BUSY;
  return `Roblox only allows one search a minute without an account. Try again in ${Math.ceil(waitMs / 1000)} seconds, or add an account.`;
}

const defaultTransport = anonymousSearchTransport();
const searchCache = new Map<string, { at: number; games: GameSummary[] }>();
let latestSearch = 0;

function rememberSearch(query: string, games: GameSummary[]): void {
  searchCache.delete(query);
  searchCache.set(query, { at: Date.now(), games });
  if (searchCache.size > SEARCH_CACHE_SIZE) searchCache.delete(searchCache.keys().next().value as string);
}

/**
 * Returns null when Roblox can't be reached, and an empty list when nothing
 * matches. A search replaced by a newer one also returns an empty list, since
 * nobody is waiting for it anymore.
 */
export async function searchGames(
  query: string,
  limit = 24,
  transport: SearchTransport = defaultTransport,
): Promise<GameSummary[] | null> {
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.games;

  const search = ++latestSearch;
  for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt++) {
    const wait = transport.notBefore - Date.now();
    if (wait > MAX_SEARCH_WAIT_MS) throw new Error(searchLimitMessage(transport, wait));
    if (wait > 0) await sleep(wait);
    if (search !== latestSearch) return [];

    const params = new URLSearchParams({ searchQuery: query, sessionId: randomUUID(), pageType: "all" });
    const result = await transport.get(`https://apis.roblox.com/search-api/omni-search?${params.toString()}`);
    if (result.status === "limited") {
      transport.notBefore = Date.now() + result.retryAfterMs;
      continue;
    }
    if (result.status !== "ok") return null;
    if (result.cooldownMs) transport.notBefore = Date.now() + result.cooldownMs;

    const listings = (result.data.searchResults ?? [])
      .filter((group) => group.contentGroupType === "Game")
      .flatMap((group) => group.contents ?? []);
    const games = await toSummaries(listings, limit);
    rememberSearch(query, games);
    return games;
  }
  throw new Error(ROBLOX_BUSY);
}

export async function getPopularGames(limit = 12): Promise<GameSummary[] | null> {
  const params = new URLSearchParams({ sessionId: randomUUID(), device: "computer", country: "all" });
  const data = await getJson<{ sorts?: Array<{ sortId?: string; games?: GameListing[] }> }>(
    `https://apis.roblox.com/explore-api/v1/get-sorts?${params.toString()}`,
  );
  if (!data) return null;
  const sorts = data.sorts ?? [];
  const sort = sorts.find((item) => item.sortId === "top-playing-now") ?? sorts.find((item) => item.games?.length);
  return toSummaries(sort?.games ?? [], limit);
}

/**
 * Always fresh, because the player count changes constantly. Returns null when
 * Roblox says the game doesn't exist, and throws when Roblox can't be reached.
 */
export async function getGameDetails(placeId: string): Promise<GameDetails | null> {
  const universe = await lookUpUniverse(placeId);
  if (universe.status === "missing") return null;
  if (universe.status !== "ok") throw new Error(unavailableMessage(universe.status));
  const universeId = universe.data;

  const [games, thumbnails] = await Promise.all([
    fetchJson<{
      data?: Array<{
        name: string;
        description?: string;
        creator?: { name?: string };
        playing?: number;
        visits?: number;
        maxPlayers?: number;
      }>;
    }>(`https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`),
    getThumbnails([universeId], HERO_ART_SIZE),
  ]);

  if (games.status === "failed" || games.status === "limited") throw new Error(unavailableMessage(games.status));
  const game = games.status === "ok" ? games.data.data?.[0] : undefined;
  if (!game) return null;
  return {
    universeId,
    placeId,
    name: game.name,
    creatorName: game.creator?.name || undefined,
    playing: game.playing,
    thumbnailUrl: thumbnails.get(universeId),
    description: game.description || undefined,
    visits: game.visits,
    maxPlayers: game.maxPlayers,
  };
}

export async function getUserHeadshots(userIds: number[]): Promise<Map<number, string>> {
  const headshots = new Map<number, string>();
  if (userIds.length === 0) return headshots;
  const data = await getJson<{ data?: Array<{ targetId: number; state?: string; imageUrl?: string }> }>(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userIds.join(",")}&size=150x150&format=Png&isCircular=false`,
  );
  for (const item of data?.data ?? []) {
    if (item.state === "Completed" && item.imageUrl) headshots.set(item.targetId, item.imageUrl);
  }
  return headshots;
}
