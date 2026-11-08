// Records the original state of every file Pusar touches, so mods can always
// be reverted exactly: modified files are restored, created files are deleted.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface BackupEntry {
  target: string;
  existed: boolean;
  /** File name inside the backup folder, or null if the target did not exist. */
  backupName: string | null;
}

export class BackupStore {
  constructor(readonly dir: string) {}

  /** One backup folder per install, keyed by its root folder. */
  static forInstall(backupsRoot: string, installRoot: string): BackupStore {
    const key = createHash("sha1").update(path.normalize(installRoot).toLowerCase()).digest("hex");
    return new BackupStore(path.join(backupsRoot, key.slice(0, 16)));
  }

  private get manifestPath(): string {
    return path.join(this.dir, "manifest.json");
  }

  async entries(): Promise<BackupEntry[]> {
    try {
      return JSON.parse(await readFile(this.manifestPath, "utf8")) as BackupEntry[];
    } catch {
      return [];
    }
  }

  private async save(entries: BackupEntry[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.manifestPath, JSON.stringify(entries, null, 2));
  }

  /**
   * Call before modifying `target`. Only the first call per file records
   * anything, so the backup always holds Roblox's original, not an earlier mod.
   */
  async preserve(target: string): Promise<void> {
    const entries = await this.entries();
    if (entries.some((e) => e.target === target)) return;

    const existed = existsSync(target);
    let backupName: string | null = null;
    if (existed) {
      await mkdir(this.dir, { recursive: true });
      backupName = `${entries.length}-${path.basename(target)}`;
      await copyFile(target, path.join(this.dir, backupName));
    }
    entries.push({ target, existed, backupName });
    await this.save(entries);
  }

  async restoreAll(): Promise<{ restored: number; removed: number }> {
    const entries = await this.entries();
    let restored = 0;
    let removed = 0;
    // Reverse order, in case a file was preserved after its folder was created.
    for (const entry of [...entries].reverse()) {
      if (entry.existed && entry.backupName) {
        await mkdir(path.dirname(entry.target), { recursive: true });
        await copyFile(path.join(this.dir, entry.backupName), entry.target);
        restored++;
      } else {
        await rm(entry.target, { force: true });
        removed++;
      }
    }
    await rm(this.dir, { recursive: true, force: true });
    return { restored, removed };
  }
}
