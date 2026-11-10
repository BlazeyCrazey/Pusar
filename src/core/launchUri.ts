// Builds the roblox-player: URI that RobloxPlayerBeta.exe / Roblox.app accept.
// This is the same URI roblox.com hands to the OS when you press Play.
import { randomInt, randomUUID } from "node:crypto";
import type { PlaceTarget } from "../shared/types";

export type { PlaceTarget };

const PLACE_ID = /^\d{1,20}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRobloxUrl(text: string): URL | null {
  let url: URL;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return null;
  }
  return /(^|\.)roblox\.com$/i.test(url.hostname) ? url : null;
}

/**
 * Explains links Pusar recognizes but can't open yet, so they don't silently
 * start a public server instead. Returns null for every other input.
 */
export function unsupportedLinkReason(input: string): string | null {
  const url = parseRobloxUrl(input.trim());
  if (!url) return null;
  const isShareLink = /^\/share(\/|$)/i.test(url.pathname);
  if (url.searchParams.has("privateServerLinkCode") || (isShareLink && url.searchParams.get("type") === "Server")) {
    return "Private server links aren't supported yet.";
  }
  if (isShareLink) return "Roblox share links aren't supported yet. Open the game's page and copy that link instead.";
  return null;
}

/**
 * Accepts a place ID ("606849621"), a game page link
 * ("https://www.roblox.com/games/606849621/Jailbreak"), or a join link
 * ("...games/start?placeId=1&gameInstanceId=<uuid>").
 */
export function parsePlaceTarget(input: string): PlaceTarget | null {
  const text = input.trim();
  if (PLACE_ID.test(text)) return { placeId: text };

  const url = parseRobloxUrl(text);
  if (!url) return null;

  const jobIdParam = url.searchParams.get("gameInstanceId") ?? url.searchParams.get("jobId");
  const jobId = jobIdParam && JOB_ID.test(jobIdParam) ? jobIdParam : undefined;

  const queryPlace = url.searchParams.get("placeId");
  if (queryPlace && PLACE_ID.test(queryPlace)) return { placeId: queryPlace, jobId };

  const pathMatch = /\/games\/(\d{1,20})(?:\/|$)/i.exec(url.pathname);
  if (pathMatch?.[1]) return { placeId: pathMatch[1], jobId };

  return null;
}

export function generateBrowserTrackerId(): string {
  // roblox.com uses a 10-13 digit number.
  return String(randomInt(1_000_000_000, 281_474_976_710_655)).slice(0, 13);
}

export function buildPlaceLauncherUrl(
  target: PlaceTarget,
  browserTrackerId: string,
  joinAttemptId: string = randomUUID(),
): string {
  if (!PLACE_ID.test(target.placeId)) throw new Error(`Invalid place ID: ${target.placeId}`);
  const params = new URLSearchParams({
    request: target.jobId ? "RequestGameJob" : "RequestGame",
    browserTrackerId,
    placeId: target.placeId,
  });
  if (target.jobId) {
    if (!JOB_ID.test(target.jobId)) throw new Error(`Invalid server ID: ${target.jobId}`);
    params.set("gameId", target.jobId);
  }
  params.set("isPlayTogetherGame", "false");
  params.set("joinAttemptId", joinAttemptId);
  params.set("joinAttemptOrigin", "PlayButton");
  return `https://www.roblox.com/Game/PlaceLauncher.ashx?${params.toString()}`;
}

export interface LaunchUriOptions {
  ticket: string;
  placeLauncherUrl: string;
  browserTrackerId: string;
  launchTime?: number;
  locale?: string;
}

export function buildLaunchUri(o: LaunchUriOptions): string {
  // '+' separates fields, so a ticket containing one would corrupt the URI.
  if (!o.ticket || /[+\s]/.test(o.ticket)) throw new Error("Auth ticket is empty or malformed");
  const locale = o.locale ?? "en_us";
  return [
    "roblox-player:1",
    "launchmode:play",
    `gameinfo:${o.ticket}`,
    `launchtime:${o.launchTime ?? Date.now()}`,
    `placelauncherurl:${encodeURIComponent(o.placeLauncherUrl)}`,
    `browsertrackerid:${o.browserTrackerId}`,
    `robloxLocale:${locale}`,
    `gameLocale:${locale}`,
    "channel:",
    "LaunchExp:InApp",
  ].join("+");
}
