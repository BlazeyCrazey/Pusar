// Keeps InstanceTracker fed and tells the UI when the state changes.
import { InstanceTracker } from "../core/instanceTracker";
import type { LogEvent } from "../core/logParser";
import { RobloxLogWatcher } from "../core/logWatcher";
import type { InstanceState } from "../shared/types";
import { errorMessage, log } from "./logger";
import { currentPlatform } from "./platform";

const PROCESS_CHECK_MS = 3000;
/** A log replay can produce many states in a row. Only the last one should reach the UI. */
const NOTIFY_DELAY_MS = 200;

export class InstanceMonitor {
  private readonly tracker = new InstanceTracker();
  private watcher: RobloxLogWatcher | null = null;
  private processTimer: NodeJS.Timeout | undefined;
  private notifyTimer: NodeJS.Timeout | undefined;
  private lastSent = JSON.stringify(this.tracker.state);

  constructor(
    private readonly onChange: (state: InstanceState) => void,
    private readonly onLogEvent: (event: LogEvent) => void = () => {},
  ) {}

  get state(): InstanceState {
    return this.tracker.state;
  }

  async start(): Promise<void> {
    const platform = currentPlatform();
    const [install] = await platform.detectInstalls();
    if (!install) return;
    // With Roblox closed, old logs can only describe sessions that are over.
    const alive = await platform.isPlayerRunning();
    this.follow(install.logsDir, alive ? 0 : Date.now());
  }

  private follow(logsDir: string, since: number): void {
    if (this.watcher) return;
    const watcher = new RobloxLogWatcher(logsDir, { since });
    watcher.on("event", (event: LogEvent) => {
      this.tracker.log(event);
      this.onLogEvent(event);
      this.scheduleNotify();
    });
    watcher.on("warning", (err: unknown) => log(`Instance monitor: ${errorMessage(err)}`));
    this.watcher = watcher;
    watcher.start();

    this.processTimer = setInterval(() => void this.checkProcess(), PROCESS_CHECK_MS);
    this.processTimer.unref();
  }

  private async checkProcess(): Promise<void> {
    if (this.tracker.state.status === "idle") return;
    try {
      this.tracker.processCheck(await currentPlatform().isPlayerRunning());
      this.scheduleNotify();
    } catch (err) {
      log(`Instance monitor: ${errorMessage(err)}`);
    }
  }

  markLaunched(placeId: string, logsDir: string): void {
    this.follow(logsDir, Date.now());
    this.tracker.launched(placeId);
    this.notifyNow();
  }

  async kill(): Promise<InstanceState> {
    await currentPlatform().killPlayers();
    this.tracker.reset();
    this.notifyNow();
    log("Killed the running Roblox instance");
    return this.tracker.state;
  }

  private scheduleNotify(): void {
    clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => this.notifyNow(), NOTIFY_DELAY_MS);
    this.notifyTimer.unref();
  }

  private notifyNow(): void {
    clearTimeout(this.notifyTimer);
    const current = JSON.stringify(this.tracker.state);
    if (current === this.lastSent) return;
    this.lastSent = current;
    this.onChange(this.tracker.state);
  }

  stop(): void {
    this.watcher?.stop();
    this.watcher = null;
    clearInterval(this.processTimer);
    clearTimeout(this.notifyTimer);
  }
}
