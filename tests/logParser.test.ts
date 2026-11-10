import { describe, expect, it } from "vitest";
import { IDLE, parseLogLine, reduceActivity, type ActivityState } from "../src/core/logParser";

// Same shapes as real Roblox player logs, with made-up IDs and documentation IPs.
const JOB = "0b5c2a8e-1f3d-4c6a-9e7b-2d4f6a8c0e1b";
const PREFIX = "2026-07-25T01:22:24.128Z,381.128357,7438,6";
const LINES = {
  joining: `${PREFIX} [FLog::Output] ! Joining game '${JOB}' place 1818 at 203.0.113.10`,
  report: `${PREFIX} [FLog::GameJoinLoadTime] Report game_join_loadtime: placeid:1818, join_time:1.42, universeid:13058, referral_page:GameDetailPageJSHybridEvent, sid:${JOB}, clienttime:1784942543.74, userid:99, `,
  udmux: `${PREFIX} [FLog::Network] UDMUX Address = 203.0.113.10, Port = 59516 | RCC Server Address = 10.32.41.202, Port = 59516`,
  joined: `2026-07-25T01:22:25.000Z,381.371063,20b0,7 [FLog::Network] serverId: 203.0.113.10|59516`,
  leaving: `${PREFIX} [FLog::SingleSurfaceApp] leaveUGCGameInternal`,
  disconnect: `${PREFIX} [FLog::Network] Time to disconnect replication data: 0.897000`,
  teleport: `${PREFIX} [FLog::SingleSurfaceApp] initiateTeleport`,
  privateServer: `${PREFIX} [FLog::GameJoinUtil] GameJoinUtil::joinGamePostPrivateServer`,
};

function run(lines: string[], start: ActivityState = IDLE): ActivityState {
  let state = start;
  for (const line of lines) {
    const event = parseLogLine(line);
    if (event) state = reduceActivity(state, event, 0);
  }
  return state;
}

describe("parseLogLine", () => {
  it("parses the join line", () => {
    expect(parseLogLine(LINES.joining)).toEqual({
      type: "joining",
      jobId: JOB,
      placeId: "1818",
      ip: "203.0.113.10",
      at: Date.parse("2026-07-25T01:22:24.128Z"),
    });
  });

  it("parses the join report", () => {
    expect(parseLogLine(LINES.report)).toMatchObject({ type: "joinReport", placeId: "1818", universeId: "13058", userId: "99" });
  });

  it("reads both addresses from the UDMUX line", () => {
    expect(parseLogLine(LINES.udmux)).toMatchObject({ type: "udmux", udmuxIp: "203.0.113.10", rccIp: "10.32.41.202" });
  });

  it("ignores unrelated lines", () => {
    expect(parseLogLine(`${PREFIX} [FLog::Output] Settings Date header was Mon`)).toBeNull();
    expect(parseLogLine("")).toBeNull();
  });
});

describe("reduceActivity", () => {
  it("tracks a full public join", () => {
    const state = run([LINES.joining, LINES.report, LINES.udmux, LINES.joined]);
    expect(state).toMatchObject({
      status: "inGame",
      placeId: "1818",
      universeId: "13058",
      jobId: JOB,
      serverIp: "203.0.113.10",
      serverType: "public",
      joinedAt: Date.parse("2026-07-25T01:22:25.000Z"),
    });
  });

  it("returns to idle when leaving", () => {
    expect(run([LINES.joining, LINES.joined, LINES.leaving]).status).toBe("idle");
  });

  it("marks private servers", () => {
    expect(run([LINES.privateServer, LINES.joining, LINES.joined]).serverType).toBe("private");
  });

  it("stays in a game across a teleport", () => {
    const afterTeleport = run([LINES.joining, LINES.joined, LINES.teleport, LINES.disconnect]);
    expect(afterTeleport.status).toBe("inGame");
    const next = run([LINES.joining.replace("place 1818", "place 2020"), LINES.joined], afterTeleport);
    expect(next).toMatchObject({ status: "inGame", placeId: "2020", teleporting: false });
  });

  it("ignores a join report for a different place", () => {
    const state = run([LINES.joining, LINES.report.replace("placeid:1818", "placeid:5")]);
    expect(state.universeId).toBeUndefined();
  });

  it("ignores a stray serverId line when not joining", () => {
    expect(run([LINES.joined]).status).toBe("idle");
  });
});
