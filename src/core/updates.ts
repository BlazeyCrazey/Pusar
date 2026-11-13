// Keeps Pusar up to date from its GitHub releases, through electron-updater.
//
// Updates download in the background and install when Pusar next closes, or
// straight away when someone presses Restart. Roblox is a separate program,
// so restarting Pusar never interrupts a game.
import type { UpdateStatus } from "../shared/types";

/** The parts of electron-updater's AppUpdater that Pusar uses. */
export interface Updater {
  allowPrerelease: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

export class UpdateService {
  private current: UpdateStatus;
  private timer: NodeJS.Timeout | undefined;

  /** A null updater means this build can't update itself, such as a run from source. */
  constructor(
    private readonly updater: Updater | null,
    private readonly onChange: (status: UpdateStatus) => void,
    private readonly log: (message: string) => void,
    private readonly now: () => number = Date.now,
    /** Someone who installed a beta keeps getting betas, or they'd be stuck on it. */
    private readonly runningBeta = false,
  ) {
    this.current = updater ? { state: "idle" } : { state: "unsupported" };
    if (!updater) return;

    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on("checking-for-update", () => this.set({ state: "checking" }));
    updater.on("update-not-available", () => this.set({ state: "upToDate", checkedAt: this.now() }));
    updater.on("update-available", (info: { version: string }) => {
      this.log(`Updates: downloading ${info.version}`);
      this.set({ state: "downloading", version: info.version, percent: 0 });
    });
    updater.on("download-progress", (progress: { percent: number }) => {
      if (this.current.state !== "downloading") return;
      this.set({ ...this.current, percent: Math.max(0, Math.min(100, Math.round(progress.percent))) });
    });
    updater.on("update-downloaded", (info: { version: string }) => {
      this.log(`Updates: ${info.version} is ready and installs when Pusar restarts`);
      this.set({ state: "ready", version: info.version });
    });
    updater.on("error", (err: Error) => {
      this.log(`Updates: ${err.message.split("\n")[0] ?? "failed"}`);
      // A finished download stays usable even if a later check fails.
      if (this.current.state !== "ready") this.set({ state: "error" });
    });
  }

  get status(): UpdateStatus {
    return this.current;
  }

  private set(status: UpdateStatus): void {
    this.current = status;
    this.onChange(status);
  }

  /** Beta versions are GitHub pre-releases. Turning this off waits for a newer stable version. */
  setBeta(enabled: boolean): void {
    if (this.updater) this.updater.allowPrerelease = enabled || this.runningBeta;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.updater || this.current.state === "checking" || this.current.state === "downloading" || this.current.state === "ready") {
      return this.current;
    }
    try {
      await this.updater.checkForUpdates();
    } catch {
      // The error event has already reported it.
    }
    return this.current;
  }

  install(): void {
    if (this.updater && this.current.state === "ready") this.updater.quitAndInstall(false, true);
  }

  start(): void {
    if (!this.updater) return;
    this.timer = setTimeout(() => {
      void this.check();
      this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
      this.timer.unref();
    }, FIRST_CHECK_DELAY_MS);
    this.timer.unref();
  }

  stop(): void {
    clearTimeout(this.timer);
    clearInterval(this.timer);
  }
}
