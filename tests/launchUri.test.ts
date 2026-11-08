import { describe, expect, it } from "vitest";
import {
  buildLaunchUri,
  buildPlaceLauncherUrl,
  generateBrowserTrackerId,
  parsePlaceTarget,
} from "../src/core/launchUri";

const JOB = "0b5c2a8e-1f3d-4c6a-9e7b-2d4f6a8c0e1b";

describe("parsePlaceTarget", () => {
  it.each([
    ["1818", { placeId: "1818" }],
    ["  606849621 ", { placeId: "606849621" }],
    ["https://www.roblox.com/games/606849621/Jailbreak", { placeId: "606849621" }],
    ["www.roblox.com/games/606849621", { placeId: "606849621" }],
    [`https://www.roblox.com/games/start?placeId=1818&gameInstanceId=${JOB}`, { placeId: "1818", jobId: JOB }],
    ["https://www.roblox.com/games/1818/Name?privateServerLinkCode=1", { placeId: "1818" }],
  ])("parses %s", (input, expected) => {
    expect(parsePlaceTarget(input)).toEqual({ jobId: undefined, ...expected });
  });

  it.each(["", "abc", "https://evil.example/games/1818", "https://www.roblox.com/users/1/profile"])(
    "rejects %s",
    (input) => {
      expect(parsePlaceTarget(input)).toBeNull();
    },
  );

  it("drops a malformed server ID instead of passing it on", () => {
    expect(parsePlaceTarget("https://www.roblox.com/games/start?placeId=1&gameInstanceId=x+y")).toEqual({
      placeId: "1",
      jobId: undefined,
    });
  });
});

describe("buildPlaceLauncherUrl", () => {
  it("requests a game by place", () => {
    const url = new URL(buildPlaceLauncherUrl({ placeId: "1818" }, "123", "attempt-1"));
    expect(url.origin + url.pathname).toBe("https://www.roblox.com/Game/PlaceLauncher.ashx");
    expect(url.searchParams.get("request")).toBe("RequestGame");
    expect(url.searchParams.get("placeId")).toBe("1818");
    expect(url.searchParams.get("browserTrackerId")).toBe("123");
    expect(url.searchParams.get("joinAttemptId")).toBe("attempt-1");
    expect(url.searchParams.has("gameId")).toBe(false);
  });

  it("requests a specific server when a job ID is given", () => {
    const url = new URL(buildPlaceLauncherUrl({ placeId: "1818", jobId: JOB }, "123"));
    expect(url.searchParams.get("request")).toBe("RequestGameJob");
    expect(url.searchParams.get("gameId")).toBe(JOB);
  });

  it("rejects bad IDs", () => {
    expect(() => buildPlaceLauncherUrl({ placeId: "12a" }, "1")).toThrow();
    expect(() => buildPlaceLauncherUrl({ placeId: "1", jobId: "nope" }, "1")).toThrow();
  });
});

describe("buildLaunchUri", () => {
  it("builds the roblox-player URI in the order roblox.com uses", () => {
    const uri = buildLaunchUri({
      ticket: "TICKET",
      placeLauncherUrl: "https://www.roblox.com/Game/PlaceLauncher.ashx?request=RequestGame&placeId=1",
      browserTrackerId: "42",
      launchTime: 1000,
    });
    expect(uri).toBe(
      "roblox-player:1+launchmode:play+gameinfo:TICKET+launchtime:1000+placelauncherurl:" +
        "https%3A%2F%2Fwww.roblox.com%2FGame%2FPlaceLauncher.ashx%3Frequest%3DRequestGame%26placeId%3D1" +
        "+browsertrackerid:42+robloxLocale:en_us+gameLocale:en_us+channel:+LaunchExp:InApp",
    );
  });

  it("refuses tickets that would corrupt the URI", () => {
    const base = { placeLauncherUrl: "https://x", browserTrackerId: "1" };
    expect(() => buildLaunchUri({ ...base, ticket: "" })).toThrow();
    expect(() => buildLaunchUri({ ...base, ticket: "a+b" })).toThrow();
  });
});

describe("generateBrowserTrackerId", () => {
  it("returns 10-13 digits", () => {
    for (let i = 0; i < 50; i++) expect(generateBrowserTrackerId()).toMatch(/^\d{10,13}$/);
  });
});
