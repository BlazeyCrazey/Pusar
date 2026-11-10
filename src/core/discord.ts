// Discord Rich Presence for the current Roblox game.
import type { Client } from "@xhayper/discord-rpc";
import type { ActivityState } from "./logParser";
import type { GameInfo, PresencePayload } from "../shared/types";

export type { PresencePayload };

const SERVER_LABEL = {
  public: "Public server",
  private: "Private server",
  reserved: "Reserved server",
} as const;

export function buildPresence(state: ActivityState, game: GameInfo | null, region?: string | null): PresencePayload | null {
  if (state.status === "idle" || !state.placeId) return null;
  const name = game?.name ?? "a Roblox experience";

  const payload: PresencePayload = {
    details: state.status === "joining" ? `Joining ${name}` : `Playing ${name}`,
    state: region ? `${SERVER_LABEL[state.serverType]} · ${region}` : SERVER_LABEL[state.serverType],
    largeImageText: name,
    buttons: [{ label: "View game", url: `https://www.roblox.com/games/${state.placeId}` }],
  };
  if (game?.iconUrl) payload.largeImageKey = game.iconUrl;
  if (state.status === "inGame" && state.joinedAt) payload.startTimestamp = state.joinedAt;
  // Only public servers can be joined by others from a link.
  if (state.serverType === "public" && state.jobId) {
    payload.buttons!.push({
      label: "Join server",
      url: `https://www.roblox.com/games/start?placeId=${state.placeId}&gameInstanceId=${state.jobId}`,
    });
  }
  return payload;
}

/**
 * Sends only the newest value, after rapid changes settle and never more often
 * than `minIntervalMs`. A game join produces several states within seconds, and
 * Discord's older docs limit presence to one update per 15 seconds; sending them
 * all left Discord stuck on "Joining" (2026-11-08).
 */
export class LatestValueThrottle<T> {
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private pending: { value: T } | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly send: (value: T) => void,
    private readonly settleMs = 4_000,
    private readonly minIntervalMs = 15_000,
  ) {}

  push(value: T): void {
    this.pending = { value };
    // Later pushes only replace the value, so constant changes can't delay the send forever.
    if (this.timer) return;
    const wait = Math.max(this.settleMs, this.lastSentAt + this.minIntervalMs - Date.now());
    this.timer = setTimeout(() => this.fire(), wait);
  }

  private fire(): void {
    this.timer = undefined;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    this.lastSentAt = Date.now();
    this.send(pending.value);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
  }
}

export class DiscordPresence {
  private client: Client | null = null;
  private connected = false;
  private readonly throttle = new LatestValueThrottle<PresencePayload | null>((payload) => void this.send(payload));

  constructor(
    private readonly clientId: string,
    private readonly log: (message: string) => void,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<boolean> {
    try {
      const { Client: RpcClient } = await import("@xhayper/discord-rpc");
      this.client = new RpcClient({ clientId: this.clientId });
      // Discord closing or restarting shouldn't end presence for good: the next game reconnects.
      this.client.on("disconnected", () => {
        this.connected = false;
      });
      await this.client.login();
      this.connected = true;
      this.log("Discord: connected");
    } catch (err) {
      this.connected = false;
      this.log(`Discord: could not connect (${err instanceof Error ? err.message : String(err)}). Is the Discord app running?`);
    }
    return this.connected;
  }

  set(payload: PresencePayload | null): void {
    if (this.connected) this.throttle.push(payload);
  }

  private async send(payload: PresencePayload | null): Promise<void> {
    if (!this.connected || !this.client?.user) return;
    try {
      if (payload) await this.client.user.setActivity(payload);
      else await this.client.user.clearActivity();
      this.log(payload ? `Discord: showing "${payload.details}"` : "Discord: cleared");
    } catch (err) {
      this.log(`Discord: update failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  async destroy(): Promise<void> {
    this.throttle.cancel();
    try {
      await this.client?.user?.clearActivity();
      await this.client?.destroy();
    } catch {
      // Discord already gone.
    }
    this.connected = false;
    this.client = null;
  }
}
