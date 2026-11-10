import { describe, expect, it } from "vitest";
import { InstanceTracker } from "../src/core/instanceTracker";
import type { LogEvent } from "../src/core/logParser";

const T0 = Date.parse("2026-11-08T22:00:00Z");
const JOB = "0b5c2a8e-1f3d-4c6a-9e7b-2d4f6a8c0e1b";

const joining = (at: number, placeId = "189707"): LogEvent => ({ type: "joining", jobId: JOB, placeId, ip: "203.0.113.1", at });
const joined = (at: number): LogEvent => ({ type: "joined", serverIp: "203.0.113.1", port: "5000", at });
const leaving = (at: number): LogEvent => ({ type: "leaving", at });

describe("InstanceTracker", () => {
  it("starts idle", () => {
    expect(new InstanceTracker().state).toEqual({ status: "idle" });
  });

  it("goes starting, then running, then idle after leaving the game", () => {
    const tracker = new InstanceTracker();
    tracker.launched("189707", T0);
    expect(tracker.state).toEqual({ status: "starting", placeId: "189707" });

    tracker.log(joining(T0 + 8000), T0 + 8000);
    tracker.log(joined(T0 + 9000), T0 + 9000);
    expect(tracker.state).toEqual({ status: "running", placeId: "189707" });

    tracker.log(leaving(T0 + 60_000), T0 + 60_000);
    expect(tracker.state).toEqual({ status: "idle" });
  });

  it("notices a game started outside Pusar", () => {
    const tracker = new InstanceTracker();
    tracker.log(joining(T0), T0);
    expect(tracker.state).toEqual({ status: "running", placeId: "189707" });
  });

  it("treats the tray process staying alive after leaving as idle", () => {
    const tracker = new InstanceTracker();
    tracker.log(joining(T0), T0);
    tracker.log(leaving(T0 + 1000), T0 + 1000);
    tracker.processCheck(true, T0 + 2000);
    expect(tracker.state.status).toBe("idle");
  });

  it("goes idle when the game's process disappears without a log line", () => {
    const tracker = new InstanceTracker();
    tracker.log(joining(T0), T0);
    tracker.processCheck(true, T0 + 1000);
    expect(tracker.state.status).toBe("running");
    tracker.processCheck(false, T0 + 2000);
    expect(tracker.state.status).toBe("idle");
  });

  it("isn't ended by older sessions replayed from a log file", () => {
    const tracker = new InstanceTracker();
    tracker.launched("189707", T0);
    tracker.log(joining(T0 - 3_600_000, "111"), T0);
    tracker.log(leaving(T0 - 3_500_000), T0);
    expect(tracker.state).toEqual({ status: "starting", placeId: "189707" });

    tracker.log(joining(T0 + 8000), T0 + 8000);
    expect(tracker.state).toEqual({ status: "running", placeId: "189707" });
  });

  it("gives a new launch time to create its process", () => {
    const tracker = new InstanceTracker();
    tracker.launched("189707", T0);
    tracker.processCheck(false, T0 + 5000);
    expect(tracker.state.status).toBe("starting");
    tracker.processCheck(false, T0 + 16_000);
    expect(tracker.state.status).toBe("idle");
  });

  it("gives up on a launch that never reaches a game, even with the tray alive", () => {
    const tracker = new InstanceTracker();
    tracker.launched("189707", T0);
    tracker.processCheck(true, T0 + 30_000);
    expect(tracker.state.status).toBe("starting");
    tracker.processCheck(true, T0 + 61_000);
    expect(tracker.state.status).toBe("idle");
  });

  it("does nothing on process checks while idle", () => {
    const tracker = new InstanceTracker();
    tracker.processCheck(true, T0);
    expect(tracker.state.status).toBe("idle");
  });

  it("forgets the session when reset after a kill", () => {
    const tracker = new InstanceTracker();
    tracker.log(joining(T0), T0);
    tracker.reset();
    expect(tracker.state.status).toBe("idle");
    tracker.log(joined(T0 + 1000), T0 + 1000);
    expect(tracker.state.status).toBe("idle");
  });

  it("stays running through a teleport and follows the new place", () => {
    const tracker = new InstanceTracker();
    tracker.log(joining(T0), T0);
    tracker.log({ type: "teleporting", at: T0 + 1000 }, T0 + 1000);
    tracker.log({ type: "disconnected", at: T0 + 2000 }, T0 + 2000);
    expect(tracker.state).toEqual({ status: "running", placeId: "189707" });
    tracker.log(joining(T0 + 3000, "222"), T0 + 3000);
    expect(tracker.state).toEqual({ status: "running", placeId: "222" });
  });
});
