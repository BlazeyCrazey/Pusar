import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEvent } from "../src/core/logParser";
import type { ActivityUpdate } from "../src/shared/types";

const presences: FakePresence[] = [];

class FakePresence {
  isConnected = false;
  set = vi.fn();
  destroy = vi.fn(async () => {});
  connect = vi.fn(async () => {
    this.isConnected = true;
    return true;
  });
  constructor(readonly clientId: string) {
    presences.push(this);
  }
}

vi.mock("../src/core/discord", async (original) => ({
  ...(await original<typeof import("../src/core/discord")>()),
  DiscordPresence: FakePresence,
}));
vi.mock("../src/core/robloxApi", () => ({
  getUniverseId: vi.fn(async () => "55"),
  getGameInfo: vi.fn(async (universeId: string) => ({ universeId, name: "Tower Game" })),
}));
const lookUpServerRegion = vi.fn(async (_ip: string): Promise<string | null> => "Ashburn, US");
vi.mock("../src/core/serverRegion", () => ({ lookUpServerRegion: (ip: string) => lookUpServerRegion(ip) }));

const { ActivityService } = await import("../src/main/activity");

const JOB = "11111111-2222-3333-4444-555555555555";
const JOINING: LogEvent = { type: "joining", jobId: JOB, placeId: "100", ip: "10.1.2.3" };
const UDMUX: LogEvent = { type: "udmux", udmuxIp: "128.116.1.1", rccIp: "10.1.2.3" };
const JOINED: LogEvent = { type: "joined", serverIp: "10.1.2.3", port: "5000", at: 1000 };
const LEAVING: LogEvent = { type: "leaving" };

function setUp() {
  const updates: ActivityUpdate[] = [];
  const service = new ActivityService((update) => updates.push(update));
  /** Waits for queued events: each awaits a few lookups before the next starts. */
  const settled = async () => {
    await vi.waitFor(async () => {
      const before = updates.length;
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(updates.length).toBe(before);
    });
  };
  const feedAll = async (events: LogEvent[]) => {
    for (const event of events) service.feed(event);
    await settled();
  };
  return { service, updates, feedAll, settled };
}

beforeEach(() => {
  presences.length = 0;
  lookUpServerRegion.mockClear();
});

describe("server region", () => {
  it("stays off until it's turned on, so nothing is sent anywhere", async () => {
    const { service, updates, feedAll } = setUp();
    await service.configure({ showRegion: false });
    await feedAll([JOINING, UDMUX, JOINED]);
    expect(lookUpServerRegion).not.toHaveBeenCalled();
    expect(updates.at(-1)?.region).toBeUndefined();
  });

  it("locates the relay's public address, and adds it to the presence", async () => {
    const { service, updates, feedAll } = setUp();
    await service.configure({ showRegion: true });
    await feedAll([JOINING, UDMUX, JOINED]);
    expect(lookUpServerRegion).toHaveBeenCalledWith("128.116.1.1");
    expect(updates.at(-1)).toMatchObject({ region: "Ashburn, US", presence: { state: "Public server · Ashburn, US" } });
  });

  it("still shows the game when the place can't be found", async () => {
    lookUpServerRegion.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const { service, updates, feedAll } = setUp();
    await service.configure({ showRegion: true });
    await feedAll([JOINING, UDMUX, JOINED]);
    expect(updates.at(-1)).toMatchObject({ game: { name: "Tower Game" }, presence: { state: "Public server" } });
    expect(updates.at(-1)?.region).toBeUndefined();
  });
});

describe("Discord presence", () => {
  const discord = { discordClientId: "123456789012345678", showRegion: false };

  it("isn't created unless the setting is on", async () => {
    const { service, feedAll } = setUp();
    await service.configure({ showRegion: false });
    await feedAll([JOINING, JOINED]);
    expect(presences).toHaveLength(0);
  });

  it("connects only once there's a game to show", async () => {
    const { service, feedAll } = setUp();
    await service.configure(discord);
    expect(presences[0]?.connect).not.toHaveBeenCalled();
    await feedAll([JOINING, JOINED]);
    expect(presences[0]?.connect).toHaveBeenCalledTimes(1);
    expect(presences[0]?.set).toHaveBeenLastCalledWith(expect.objectContaining({ details: "Playing Tower Game" }));
  });

  it("tries again if Discord wasn't running at first", async () => {
    const { service, feedAll } = setUp();
    await service.configure(discord);
    const first = presences[0]!;
    first.connect.mockImplementationOnce(async () => false);
    await feedAll([JOINING, JOINED]);
    expect(first.connect).toHaveBeenCalledTimes(2);
  });

  it("clears when the player leaves", async () => {
    const { service, feedAll } = setUp();
    await service.configure(discord);
    await feedAll([JOINING, JOINED, LEAVING]);
    expect(presences[0]?.set).toHaveBeenLastCalledWith(null);
    expect(service.current).toBeNull();
  });

  it("shows a game already in progress as soon as it's turned on", async () => {
    const { service, feedAll, settled } = setUp();
    await service.configure({ showRegion: false });
    await feedAll([JOINING, JOINED]);
    await service.configure(discord);
    await settled();
    expect(presences[0]?.set).toHaveBeenLastCalledWith(expect.objectContaining({ details: "Playing Tower Game" }));
  });

  it("disconnects when it's turned off", async () => {
    const { service } = setUp();
    await service.configure(discord);
    await service.configure({ showRegion: false });
    expect(presences[0]?.destroy).toHaveBeenCalled();
  });

  it("reconnects with a new application ID, and not for the same one", async () => {
    const { service } = setUp();
    await service.configure(discord);
    await service.configure(discord);
    expect(presences).toHaveLength(1);
    await service.configure({ ...discord, discordClientId: "987654321098765432" });
    expect(presences).toHaveLength(2);
    expect(presences[0]?.destroy).toHaveBeenCalled();
  });
});

describe("when Roblox stops without saying so", () => {
  it("ends the game anyway, as after a crash or Kill Instance", async () => {
    const { service, updates, feedAll, settled } = setUp();
    await service.configure({ discordClientId: "123456789012345678", showRegion: false });
    await feedAll([JOINING, JOINED]);
    service.gameEnded();
    await settled();
    expect(service.current).toBeNull();
    expect(updates.at(-1)).toMatchObject({ state: { status: "idle" }, presence: null });
    expect(presences[0]?.set).toHaveBeenLastCalledWith(null);
  });

  it("sends nothing when no game was being tracked", async () => {
    const { service, updates, settled } = setUp();
    service.gameEnded();
    await settled();
    expect(updates).toEqual([]);
  });
});

describe("the current game", () => {
  it("can be read back after the window reloads", async () => {
    const { service, feedAll } = setUp();
    expect(service.current).toBeNull();
    await feedAll([JOINING, JOINED]);
    expect(service.current?.state.status).toBe("inGame");
  });
});
