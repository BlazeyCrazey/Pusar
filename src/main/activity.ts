// Ties the log watcher, game lookups and Discord presence together.
import path from "node:path";
import { buildPresence, DiscordPresence, type PresencePayload } from "../core/discord";
import { IDLE, reduceActivity, type ActivityState, type LogEvent } from "../core/logParser";
import { RobloxLogWatcher } from "../core/logWatcher";
import { getGameInfo, getUniverseId, type GameInfo } from "../core/robloxApi";
import { errorMessage, log } from "./logger";

export interface ActivityUpdate {
  state: ActivityState;
  game: GameInfo | null;
  presence: PresencePayload | null;
}

export class ActivityService {
  private watcher: RobloxLogWatcher | null = null;
  private presence: DiscordPresence | null = null;
  private state: ActivityState = IDLE;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly onUpdate: (update: ActivityUpdate) => void) {}

  get running(): boolean {
    return this.watcher !== null;
  }

  async start(logsDir: string, opts: { discordClientId?: string; followExistingLog?: boolean }): Promise<void> {
    await this.stop();
    if (opts.discordClientId) {
      this.presence = new DiscordPresence(opts.discordClientId, log);
      await this.presence.connect();
    } else {
      log("Activity: no Discord client ID set, so presence is shown here only (dry run)");
    }

    // By default only follow logs created from now on, i.e. a game launched after this point.
    const watcher = new RobloxLogWatcher(logsDir, { since: opts.followExistingLog ? 0 : Date.now() - 2000 });
    watcher.on("file", (file: string) => log(`Activity: following ${path.basename(file)}`));
    watcher.on("warning", (err: unknown) => log(`Activity: ${errorMessage(err)}`));
    // Serialize handling so lookups for one event finish before the next.
    watcher.on("event", (event: LogEvent) => {
      this.queue = this.queue.then(() => this.handle(event)).catch((err) => log(`Activity: ${errorMessage(err)}`));
    });
    this.watcher = watcher;
    watcher.start();
    log(`Activity: watching ${logsDir}`);
  }

  private async handle(event: LogEvent): Promise<void> {
    const prev = this.state;
    this.state = reduceActivity(prev, event);
    const changed =
      prev.status !== this.state.status ||
      prev.placeId !== this.state.placeId ||
      prev.universeId !== this.state.universeId;
    if (!changed) return;

    let game: GameInfo | null = null;
    if (this.state.placeId) {
      const universeId = this.state.universeId ?? (await getUniverseId(this.state.placeId));
      if (universeId) game = await getGameInfo(universeId);
    }
    const presence = buildPresence(this.state, game);
    log(
      this.state.status === "idle"
        ? "Activity: not in a game"
        : `Activity: ${this.state.status} ${game?.name ?? `place ${this.state.placeId}`} (${this.state.serverType} server)`,
    );
    this.presence?.set(presence);
    this.onUpdate({ state: this.state, game, presence });
  }

  async stop(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    await this.presence?.destroy();
    this.presence = null;
    this.state = IDLE;
  }
}
