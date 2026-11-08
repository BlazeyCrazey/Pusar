// Follows the newest Roblox player log and emits parsed activity events.
// Polls instead of fs.watch because fs.watch is unreliable for files that
// another process keeps open (Roblox) on both Windows and macOS.
import { EventEmitter } from "node:events";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseLogLine } from "./logParser";

export function isPlayerLog(name: string): boolean {
  return name.endsWith(".log") && /_Player_/i.test(name) && !/crash/i.test(name);
}

export interface LogWatcherOptions {
  pollMs?: number;
  /** Ignore logs last modified before this time (ms). 0 = follow the newest log, even an old one. */
  since?: number;
}

/**
 * Events: "file" (path), "event" (LogEvent), "warning" (Error).
 */
export class RobloxLogWatcher extends EventEmitter {
  private timer: NodeJS.Timeout | undefined;
  private file: string | undefined;
  private offset = 0;
  private partial = "";
  private busy = false;

  constructor(
    readonly logsDir: string,
    private readonly opts: LogWatcherOptions = {},
  ) {
    super();
  }

  get currentFile(): string | undefined {
    return this.file;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 1000);
    void this.poll();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async newestPlayerLog(): Promise<{ file: string; mtime: number } | null> {
    let names: string[];
    try {
      names = await readdir(this.logsDir);
    } catch {
      return null;
    }
    let best: { file: string; mtime: number } | null = null;
    for (const name of names) {
      if (!isPlayerLog(name)) continue;
      const file = path.join(this.logsDir, name);
      try {
        const { mtimeMs } = await stat(file);
        if (!best || mtimeMs > best.mtime) best = { file, mtime: mtimeMs };
      } catch {
        // Deleted between readdir and stat.
      }
    }
    return best;
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const newest = await this.newestPlayerLog();
      if (newest && newest.file !== this.file && newest.mtime >= (this.opts.since ?? 0)) {
        this.file = newest.file;
        this.offset = 0;
        this.partial = "";
        this.emit("file", newest.file);
      }
      if (this.file) await this.readNew(this.file);
    } catch (err) {
      this.emit("warning", err);
    } finally {
      this.busy = false;
    }
  }

  private async readNew(file: string): Promise<void> {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      if (size < this.offset) {
        // File was truncated or replaced.
        this.offset = 0;
        this.partial = "";
      }
      if (size === this.offset) return;

      const length = Math.min(size - this.offset, 4 * 1024 * 1024);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
      this.offset += bytesRead;

      const lines = (this.partial + buffer.subarray(0, bytesRead).toString("utf8")).split(/\r?\n/);
      this.partial = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseLogLine(line);
        if (event) this.emit("event", event);
      }
    } finally {
      await handle.close();
    }
  }
}
