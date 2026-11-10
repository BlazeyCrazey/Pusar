// Turns Roblox's log events into Discord presence and what the UI shows about a game.
import path from "node:path";
import { buildPresence, DiscordPresence } from "../core/discord";
import { IDLE, reduceActivity, type ActivityState, type LogEvent } from "../core/logParser";
import { RobloxLogWatcher } from "../core/logWatcher";
import { getGameInfo, getUniverseId } from "../core/robloxApi";
import { lookUpServerRegion } from "../core/serverRegion";
import type { ActivityUpdate, GameInfo } from "../shared/types";
import { errorMessage, log } from "./logger";

export interface ActivitySettings {
  /** Undefined turns Discord presence off. */
  discordClientId?: string;
  showRegion: boolean;
}

export class ActivityService {
  /** Only the M0 spike panel uses its own watcher. The app is fed by the instance monitor. */
  private watcher: RobloxLogWatcher | null = null;
  private presence: DiscordPresence | null = null;
  private discordClientId: string | undefined;
  private showRegion = false;
  private state: ActivityState = IDLE;
  private latest: ActivityUpdate | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly onUpdate: (update: ActivityUpdate) => void) {}

  get running(): boolean {
    return this.watcher !== null;
  }

  /** The game being played, or null. */
  get current(): ActivityUpdate | null {
    return this.latest;
  }

  async configure(settings: ActivitySettings): Promise<void> {
    this.showRegion = settings.showRegion;
    if (settings.discordClientId === this.discordClientId) return;

    this.discordClientId = settings.discordClientId;
    await this.presence?.destroy();
    this.presence = settings.discordClientId ? new DiscordPresence(settings.discordClientId, log) : null;
    // Turned on mid-game: without this, Discord would stay blank until the next change.
    if (this.latest) await this.sendPresence(this.latest);
  }

  /** Discord is only connected while there's a game to show, and retried on each change. */
  private async sendPresence(update: ActivityUpdate): Promise<void> {
    if (!this.presence) return;
    if (update.presence && !this.presence.isConnected) await this.presence.connect();
    this.presence.set(update.presence);
  }

  /** Handles one log event, in order, so lookups for one finish before the next starts. */
  feed(event: LogEvent): void {
    if (this.watcher) return;
    this.enqueue(() => this.handle(event));
  }

  /** Roblox has stopped, so any game it was in is over, whatever its log last said. */
  gameEnded(): void {
    this.enqueue(async () => {
      if (!this.latest && this.state.status === "idle") return;
      this.state = IDLE;
      await this.publish({ state: IDLE, game: null, presence: null });
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((err: unknown) => log(`Activity: ${errorMessage(err)}`));
  }

  async start(logsDir: string, opts: { discordClientId?: string; followExistingLog?: boolean }): Promise<void> {
    await this.stop();
    if (opts.discordClientId) {
      this.discordClientId = opts.discordClientId;
      this.presence = new DiscordPresence(opts.discordClientId, log);
      await this.presence.connect();
    } else {
      log("Activity: no Discord client ID set, so presence is shown here only (dry run)");
    }

    // By default only follow logs created from now on, i.e. a game launched after this point.
    const watcher = new RobloxLogWatcher(logsDir, { since: opts.followExistingLog ? 0 : Date.now() - 2000 });
    watcher.on("file", (file: string) => log(`Activity: following ${path.basename(file)}`));
    watcher.on("warning", (err: unknown) => log(`Activity: ${errorMessage(err)}`));
    watcher.on("event", (event: LogEvent) => this.enqueue(() => this.handle(event)));
    this.watcher = watcher;
    watcher.start();
    log(`Activity: watching ${logsDir}`);
  }

  private async handle(event: LogEvent): Promise<void> {
    const prev = this.state;
    this.state = reduceActivity(prev, event);
    const newGameState =
      prev.status !== this.state.status ||
      prev.placeId !== this.state.placeId ||
      prev.universeId !== this.state.universeId;
    // The public server address arrives a moment after the join starts.
    if (!newGameState && prev.serverIp === this.state.serverIp) return;

    let game: GameInfo | null = null;
    if (this.state.placeId) {
      const universeId = this.state.universeId ?? (await getUniverseId(this.state.placeId));
      if (universeId) game = await getGameInfo(universeId);
    }
    const region = this.showRegion && this.state.serverIp ? await lookUpServerRegion(this.state.serverIp) : null;
    const presence = buildPresence(this.state, game, region);
    if (newGameState) {
      log(
        this.state.status === "idle"
          ? "Activity: not in a game"
          : `Activity: ${this.state.status} ${game?.name ?? `place ${this.state.placeId}`} (${this.state.serverType} server)`,
      );
    }
    await this.publish({ state: this.state, game, presence, ...(region ? { region } : {}) });
  }

  private async publish(update: ActivityUpdate): Promise<void> {
    this.latest = update.state.status === "idle" ? null : update;
    await this.sendPresence(update);
    this.onUpdate(update);
  }

  async stop(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    await this.presence?.destroy();
    this.presence = null;
    this.discordClientId = undefined;
    this.state = IDLE;
    this.latest = null;
  }
}
