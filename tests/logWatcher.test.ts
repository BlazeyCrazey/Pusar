import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogEvent } from "../src/core/logParser";
import { isPlayerLog, RobloxLogWatcher } from "../src/core/logWatcher";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "pusar-logs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const JOIN = "2026-07-25T01:22:24.128Z,1,1,6 [FLog::Output] ! Joining game '0b5c2a8e-1f3d-4c6a-9e7b-2d4f6a8c0e1b' place 1818 at 203.0.113.10";
const LEAVE = "2026-07-25T01:23:24.128Z,1,1,6 [FLog::SingleSurfaceApp] leaveUGCGameInternal";

describe("isPlayerLog", () => {
  it("accepts player logs and rejects crash handler and other logs", () => {
    expect(isPlayerLog("0.731.0.7310943_20261106T214254Z_Player_B240F_last.log")).toBe(true);
    expect(isPlayerLog("0.741.0.7411058_20261009T193802Z_Player_20C1E_CrashHandler_last.log")).toBe(false);
    expect(isPlayerLog("0.731.0_20261106T214254Z_Studio_AAAAA_last.log")).toBe(false);
  });
});

describe("RobloxLogWatcher", () => {
  it("follows the newest player log and reads lines as they are appended, including split lines", async () => {
    const old = path.join(dir, "0.1_20260101T000000Z_Player_AAAAA_last.log");
    writeFileSync(old, `${LEAVE}\n`);
    utimesSync(old, 1_000_000_000, 1_000_000_000);
    const current = path.join(dir, "0.1_20260102T000000Z_Player_BBBBB_last.log");
    writeFileSync(current, "");

    const watcher = new RobloxLogWatcher(dir, { since: 0 });
    const events: LogEvent[] = [];
    const files: string[] = [];
    watcher.on("event", (e: LogEvent) => events.push(e));
    watcher.on("file", (f: string) => files.push(f));

    await watcher.poll();
    expect(files).toEqual([current]);

    // Roblox can flush half a line; it must not be parsed until complete.
    appendFileSync(current, JOIN.slice(0, 40));
    await watcher.poll();
    expect(events).toEqual([]);

    appendFileSync(current, `${JOIN.slice(40)}\n${LEAVE}\n`);
    await watcher.poll();
    expect(events.map((e) => e.type)).toEqual(["joining", "leaving"]);
  });

  it("ignores logs older than `since`", async () => {
    const old = path.join(dir, "0.1_20260101T000000Z_Player_AAAAA_last.log");
    writeFileSync(old, `${JOIN}\n`);
    utimesSync(old, 1_000_000_000, 1_000_000_000);

    const watcher = new RobloxLogWatcher(dir, { since: Date.now() });
    const events: LogEvent[] = [];
    watcher.on("event", (e: LogEvent) => events.push(e));
    await watcher.poll();
    expect(watcher.currentFile).toBeUndefined();
    expect(events).toEqual([]);
  });
});
