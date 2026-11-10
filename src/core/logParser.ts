// Parses Roblox player log lines into game activity events.
// Line format: "2026-07-25T01:22:24.128Z,381.128357,7438,6 [FLog::Output] ! Joining game '<jobId>' place <placeId> at <ip>"

import type { ActivityState, ServerType } from "../shared/types";

export type LogEvent =
  | { type: "joining"; jobId: string; placeId: string; ip: string; at?: number }
  | { type: "joinReport"; placeId: string; universeId: string; userId: string; at?: number }
  | { type: "udmux"; udmuxIp: string; rccIp: string; at?: number }
  | { type: "joined"; serverIp: string; port: string; at?: number }
  | { type: "privateServer"; at?: number }
  | { type: "reservedServer"; at?: number }
  | { type: "teleporting"; at?: number }
  | { type: "leaving"; at?: number }
  | { type: "disconnected"; at?: number };

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;

const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => LogEvent]> = [
  [
    /\[FLog::Output\] ! Joining game '([0-9a-f-]{36})' place (\d+) at ([\d.]+)/,
    (m) => ({ type: "joining", jobId: m[1]!, placeId: m[2]!, ip: m[3]! }),
  ],
  [
    /\[FLog::GameJoinLoadTime\] Report game_join_loadtime: placeid:(\d+).*?universeid:(\d+).*?userid:(\d+)/,
    (m) => ({ type: "joinReport", placeId: m[1]!, universeId: m[2]!, userId: m[3]! }),
  ],
  [
    /\[FLog::Network\] UDMUX Address = ([\d.]+), Port = \d+ \| RCC Server Address = ([\d.]+), Port = \d+/,
    (m) => ({ type: "udmux", udmuxIp: m[1]!, rccIp: m[2]! }),
  ],
  [
    /\[FLog::Network\] serverId: ([\d.]+)\|(\d+)/,
    (m) => ({ type: "joined", serverIp: m[1]!, port: m[2]! }),
  ],
  [/\[FLog::GameJoinUtil\] GameJoinUtil::joinGamePostPrivateServer/, () => ({ type: "privateServer" })],
  [/\[FLog::GameJoinUtil\] GameJoinUtil::initiateTeleportToReservedServer/, () => ({ type: "reservedServer" })],
  [/\[FLog::SingleSurfaceApp\] initiateTeleport/, () => ({ type: "teleporting" })],
  [/\[FLog::SingleSurfaceApp\] leaveUGCGameInternal/, () => ({ type: "leaving" })],
  [/\[FLog::Network\] Time to disconnect replication data/, () => ({ type: "disconnected" })],
];

export function parseLogLine(line: string): LogEvent | null {
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const event = build(match);
    const ts = TIMESTAMP.exec(line);
    if (ts?.[1]) {
      const at = Date.parse(ts[1]);
      if (!Number.isNaN(at)) event.at = at;
    }
    return event;
  }
  return null;
}

export type { ActivityState, ServerType };

export const IDLE: ActivityState = { status: "idle", serverType: "public", teleporting: false };

export function reduceActivity(state: ActivityState, event: LogEvent, now = Date.now()): ActivityState {
  switch (event.type) {
    case "privateServer":
      return { ...state, pendingServerType: "private" };
    case "reservedServer":
      return { ...state, pendingServerType: "reserved" };
    case "joining":
      return {
        status: "joining",
        placeId: event.placeId,
        jobId: event.jobId,
        serverIp: event.ip,
        serverType: state.pendingServerType ?? "public",
        teleporting: false,
      };
    case "joinReport":
      if (state.placeId !== event.placeId) return state;
      return { ...state, universeId: event.universeId };
    case "udmux":
      // The RCC address is private (10.x). Only the relay in front of it can be located.
      return { ...state, serverIp: event.udmuxIp };
    case "joined":
      if (state.status === "idle") return state;
      return {
        ...state,
        status: "inGame",
        serverIp: state.serverIp ?? event.serverIp,
        joinedAt: event.at ?? now,
      };
    case "teleporting":
      return { ...state, teleporting: true };
    case "leaving":
    case "disconnected":
      // A teleport disconnects first, then joins the next server.
      if (state.teleporting) return state;
      return IDLE;
  }
}
