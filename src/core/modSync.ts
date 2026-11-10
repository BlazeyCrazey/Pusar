// Makes a Roblox install match what the user chose, and notices when it stops
// matching, such as after a Roblox update or anything overwriting a modded file.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BackupStore } from "./backup";
import { applyFlags } from "./fflags";
import { applyCustomFont } from "./fonts";
import { resolveInContent } from "./modPack";

export interface PlannedPack {
  id: string;
  dir: string;
  contentHash: string;
  files: string[];
}

/** What the user wants applied. Empty means Roblox's original files. */
export interface ModPlan {
  flags: Record<string, string>;
  fontFile: string | null;
  packs: PlannedPack[];
}

export interface ModTargets {
  contentDir: string;
  clientSettingsFile: string;
}

interface Ledger {
  planHash: string;
  flagsHash: string;
  /** Roblox reads FFlags when its process starts, so a running one has stale flags. */
  flagsNeedRestart: boolean;
  files: Array<{ target: string; sha256: string | null }>;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

async function hashFile(file: string): Promise<string | null> {
  try {
    return sha256(await readFile(file));
  } catch {
    return null;
  }
}

function hashFlags(flags: Record<string, string>): string {
  return sha256(JSON.stringify(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b))));
}

async function hashPlan(plan: ModPlan): Promise<string> {
  return sha256(
    JSON.stringify({
      flags: hashFlags(plan.flags),
      font: plan.fontFile ? await hashFile(plan.fontFile) : null,
      packs: plan.packs.map((pack) => [pack.id, pack.contentHash]),
    }),
  );
}

function isEmpty(plan: ModPlan): boolean {
  return Object.keys(plan.flags).length === 0 && !plan.fontFile && plan.packs.length === 0;
}

const ledgerPath = (backup: BackupStore) => path.join(backup.dir, "ledger.json");

async function readLedger(backup: BackupStore): Promise<Ledger | null> {
  try {
    return JSON.parse(await readFile(ledgerPath(backup), "utf8")) as Ledger;
  } catch {
    return null;
  }
}

async function writeLedger(backup: BackupStore, ledger: Ledger): Promise<void> {
  await mkdir(backup.dir, { recursive: true });
  await writeFile(ledgerPath(backup), JSON.stringify(ledger, null, 2));
}

export async function isPlanApplied(plan: ModPlan, backup: BackupStore): Promise<boolean> {
  const ledger = await readLedger(backup);
  if (!ledger) return isEmpty(plan) && (await backup.entries()).length === 0;
  if (ledger.planHash !== (await hashPlan(plan))) return false;
  for (const file of ledger.files) {
    if ((await hashFile(file.target)) !== file.sha256) return false;
  }
  return true;
}

/** Starts from Roblox's originals every time, so turning something off leaves no trace of it. */
export async function applyPlan(targets: ModTargets, plan: ModPlan, backup: BackupStore): Promise<void> {
  const previous = await readLedger(backup);
  await backup.restoreAll();

  // Packs go first, so a chosen font takes priority over a pack's fonts.
  for (const pack of plan.packs) {
    for (const relative of pack.files) {
      const source = path.join(pack.dir, "content", ...relative.split("/"));
      const target = resolveInContent(targets.contentDir, relative);
      await backup.preserve(target);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }
  if (plan.fontFile) await applyCustomFont(targets.contentDir, plan.fontFile, backup);
  if (Object.keys(plan.flags).length > 0) await applyFlags(targets.clientSettingsFile, plan.flags, backup);

  const entries = await backup.entries();
  const flagsHash = hashFlags(plan.flags);
  await writeLedger(backup, {
    planHash: await hashPlan(plan),
    flagsHash,
    flagsNeedRestart: (previous?.flagsNeedRestart ?? false) || (previous?.flagsHash ?? hashFlags({})) !== flagsHash,
    files: await Promise.all(
      entries.map(async (entry) => ({ target: entry.target, sha256: await hashFile(entry.target) })),
    ),
  });
}

export async function flagsNeedRestart(backup: BackupStore): Promise<boolean> {
  return (await readLedger(backup))?.flagsNeedRestart ?? false;
}

export async function clearFlagsNeedRestart(backup: BackupStore): Promise<void> {
  const ledger = await readLedger(backup);
  if (ledger) await writeLedger(backup, { ...ledger, flagsNeedRestart: false });
}
