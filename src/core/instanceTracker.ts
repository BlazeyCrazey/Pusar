// Works out whether Roblox is running a game.
//
// A running process alone can't answer that: Roblox keeps a background tray
// process alive after you leave a game. So the state comes from three signals:
// Pusar's own launches, Roblox's log lines, and whether the process still exists.
import type { InstanceState } from "../shared/types";
import { IDLE, reduceActivity, type ActivityState, type LogEvent } from "./logParser";

/** Give up on a launch that never reaches a game. */
const START_TIMEOUT_MS = 60_000;
/** Right after launching, the process may not exist yet. */
const START_GRACE_MS = 15_000;
const CLOCK_SKEW_MS = 2_000;

export class InstanceTracker {
  state: InstanceState = { status: "idle" };
  private activity: ActivityState = IDLE;
  private startedAt = 0;

  launched(placeId: string, now = Date.now()): void {
    this.activity = IDLE;
    this.startedAt = now;
    this.state = { status: "starting", placeId };
  }

  log(event: LogEvent, now = Date.now()): void {
    this.activity = reduceActivity(this.activity, event, now);

    // Following a log file replays its older sessions. Those mustn't end a launch in progress.
    if (this.state.status === "starting" && event.at !== undefined && event.at < this.startedAt - CLOCK_SKEW_MS) return;

    if (this.activity.status !== "idle") {
      this.state = { status: "running", placeId: this.activity.placeId };
    } else if (this.state.status === "running") {
      this.state = { status: "idle" };
    }
  }

  processCheck(alive: boolean, now = Date.now()): void {
    if (this.state.status === "running") {
      if (!alive) this.reset();
    } else if (this.state.status === "starting") {
      const age = now - this.startedAt;
      if (age > START_TIMEOUT_MS || (!alive && age > START_GRACE_MS)) this.reset();
    }
  }

  reset(): void {
    this.activity = IDLE;
    this.state = { status: "idle" };
  }
}
