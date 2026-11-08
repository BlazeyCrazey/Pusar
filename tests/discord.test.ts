import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPresence, LatestValueThrottle } from "../src/core/discord";
import { IDLE, type ActivityState } from "../src/core/logParser";

describe("LatestValueThrottle", () => {
  let sent: string[];
  let throttle: LatestValueThrottle<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    throttle = new LatestValueThrottle((value) => sent.push(value), 4_000, 15_000);
  });
  afterEach(() => vi.useRealTimers());

  it("sends only the final state of a rapid join sequence", () => {
    throttle.push("joining");
    vi.advanceTimersByTime(3_000);
    throttle.push("joining with icon");
    throttle.push("playing");
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual(["playing"]);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual(["playing"]);
  });

  it("spaces later updates by the minimum interval and never loses the last one", () => {
    throttle.push("a");
    vi.advanceTimersByTime(4_000);
    throttle.push("b");
    vi.advanceTimersByTime(14_999);
    expect(sent).toEqual(["a"]);
    throttle.push("c");
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["a", "c"]);
  });

  it("can't be delayed forever by constant changes", () => {
    throttle.push("first");
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1_000);
      throttle.push(`change ${i}`);
    }
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual(["change 2"]);
  });

  it("drops anything pending when cancelled", () => {
    throttle.push("a");
    throttle.cancel();
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
  });

  it("can deliver a clear (null) as the final state", () => {
    const values: Array<string | null> = [];
    const clearing = new LatestValueThrottle<string | null>((value) => values.push(value), 4_000, 15_000);
    clearing.push("playing");
    clearing.push(null);
    vi.advanceTimersByTime(4_000);
    expect(values).toEqual([null]);
  });
});

const JOB = "0b5c2a8e-1f3d-4c6a-9e7b-2d4f6a8c0e1b";
const inGame: ActivityState = {
  status: "inGame",
  placeId: "1818",
  jobId: JOB,
  serverType: "public",
  joinedAt: 1234,
  teleporting: false,
};

describe("buildPresence", () => {
  it("shows nothing when idle", () => {
    expect(buildPresence(IDLE, null)).toBeNull();
  });

  it("shows the game, icon, timer and join button for public servers", () => {
    expect(buildPresence(inGame, { universeId: "1", name: "Crossroads", iconUrl: "https://tr.rbxcdn.com/i.png" })).toEqual({
      details: "Playing Crossroads",
      state: "Public server",
      largeImageKey: "https://tr.rbxcdn.com/i.png",
      largeImageText: "Crossroads",
      startTimestamp: 1234,
      buttons: [
        { label: "View game", url: "https://www.roblox.com/games/1818" },
        { label: "Join server", url: `https://www.roblox.com/games/start?placeId=1818&gameInstanceId=${JOB}` },
      ],
    });
  });

  it("never offers a join button for private servers", () => {
    const presence = buildPresence({ ...inGame, serverType: "private" }, null);
    expect(presence?.buttons).toEqual([{ label: "View game", url: "https://www.roblox.com/games/1818" }]);
    expect(presence?.details).toBe("Playing a Roblox experience");
  });

  it("says Joining and has no timer while joining", () => {
    const presence = buildPresence({ ...inGame, status: "joining", joinedAt: undefined }, { universeId: "1", name: "X" });
    expect(presence?.details).toBe("Joining X");
    expect(presence?.startTimestamp).toBeUndefined();
  });
});
