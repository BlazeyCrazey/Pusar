// Holds what the user chose (saved independently of any Roblox version) and
// keeps the current Roblox install in line with it.
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ModsOverview, Platform, RobloxInstall } from "../shared/types";
import { BackupStore } from "./backup";
import { ALLOWED_FLAGS, FLAG_DEFAULTS, flagKind, flagValueError, MOD_PRESETS } from "./fflags";
import { importPackFromFolder, importPackFromZip, listPacks, PACK_LIMITS, PackError, removePack, type InstalledPack } from "./modPack";
import { applyPlan, clearFlagsNeedRestart, flagsNeedRestart, isPlanApplied, type ModPlan } from "./modSync";

const configSchema = z.object({
  enabled: z.boolean().default(true),
  flags: z.record(z.string(), z.string()).default({}),
  font: z.string().nullable().default(null),
  packs: z.record(z.string(), z.boolean()).default({}),
});

type ModsConfig = z.infer<typeof configSchema>;

export interface ModsDependencies {
  /** Where Pusar keeps its data. */
  dataDir: string;
  platform: Platform;
  detectInstalls(): Promise<RobloxInstall[]>;
  isPlayerRunning(): Promise<boolean>;
  killPlayers(): Promise<void>;
  /** False while a game is running, when Roblox's files shouldn't be touched. */
  canApplyNow(): boolean;
  log(message: string): void;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** TrueType, OpenType and "true" Mac fonts start with one of these. */
function looksLikeFont(header: Uint8Array): boolean {
  const tag = String.fromCharCode(...header.subarray(0, 4));
  return tag === "\u0000\u0001\u0000\u0000" || tag === "OTTO" || tag === "true";
}

export class ModsService {
  private readonly configPath: string;
  private readonly fontsDir: string;
  private readonly packsRoot: string;
  private readonly backupsRoot: string;
  // Anything touching files runs one at a time, so quick clicks can't interleave.
  private queue: Promise<unknown> = Promise.resolve();
  private lastError: string | undefined;

  constructor(private readonly deps: ModsDependencies) {
    const modsDir = path.join(deps.dataDir, "mods");
    this.configPath = path.join(modsDir, "config.json");
    this.fontsDir = path.join(modsDir, "fonts");
    this.packsRoot = path.join(modsDir, "packs");
    this.backupsRoot = path.join(deps.dataDir, "backups");
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  private readConfig(): ModsConfig {
    try {
      return configSchema.parse(JSON.parse(readFileSync(this.configPath, "utf8")));
    } catch {
      return configSchema.parse({});
    }
  }

  private async writeConfig(config: ModsConfig): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  private backupFor(install: RobloxInstall): BackupStore {
    return BackupStore.forInstall(this.backupsRoot, install.rootDir);
  }

  private async buildPlan(config: ModsConfig, packs: InstalledPack[]): Promise<ModPlan> {
    if (!config.enabled) return { flags: {}, fontFile: null, packs: [] };
    const fontFile = config.font ? path.join(this.fontsDir, config.font) : null;
    return {
      // Roblox would ignore anything else, and a damaged config shouldn't reach its files.
      flags: Object.fromEntries(Object.entries(config.flags).filter(([name, value]) => !flagValueError(name, value))),
      fontFile: fontFile && existsSync(fontFile) ? fontFile : null,
      packs: packs.filter((pack) => config.packs[pack.id] !== false),
    };
  }

  /** Brings an install in line with the saved choices. Returns true if files changed. */
  private async sync(install: RobloxInstall): Promise<boolean> {
    const config = this.readConfig();
    const plan = await this.buildPlan(config, await listPacks(this.packsRoot, this.deps.platform));
    const backup = this.backupFor(install);
    if (await isPlanApplied(plan, backup)) return false;
    await applyPlan(install, plan, backup);
    this.deps.log(`Mods: applied to ${install.versionId ?? install.rootDir}`);
    return true;
  }

  private async syncCurrent(): Promise<void> {
    if (!this.deps.canApplyNow()) return;
    const [install] = await this.deps.detectInstalls();
    if (!install) return;
    try {
      await this.sync(install);
      this.lastError = undefined;
    } catch (err) {
      this.lastError = messageOf(err);
      this.deps.log(`Mods: couldn't apply (${this.lastError})`);
    }
  }

  /** Picks up a Roblox update as soon as Pusar opens. */
  syncOnStartup(): Promise<void> {
    return this.enqueue(() => this.syncCurrent());
  }

  private change(mutate: (config: ModsConfig) => void): Promise<ModsOverview> {
    return this.enqueue(async () => {
      const config = this.readConfig();
      mutate(config);
      await this.writeConfig(config);
      await this.syncCurrent();
      return this.buildOverview();
    });
  }

  overview(): Promise<ModsOverview> {
    return this.enqueue(() => this.buildOverview());
  }

  private async buildOverview(): Promise<ModsOverview> {
    const config = this.readConfig();
    const packs = await listPacks(this.packsRoot, this.deps.platform);
    const enabledPacks = packs.filter((pack) => config.packs[pack.id] !== false);

    const [install] = await this.deps.detectInstalls();
    let state: ModsOverview["sync"]["state"] = "noRoblox";
    if (install) {
      const applied = await isPlanApplied(await this.buildPlan(config, packs), this.backupFor(install));
      state = applied ? "applied" : "pending";
    }

    return {
      enabled: config.enabled,
      flags: Object.entries(config.flags).map(([name, value]) => ({
        name,
        value,
        kind: flagKind(name),
        description: ALLOWED_FLAGS[name] ?? "",
      })),
      availableFlags: Object.entries(ALLOWED_FLAGS)
        .filter(([name]) => !(name in config.flags))
        .map(([name, description]) => ({ name, description })),
      presets: MOD_PRESETS.map(({ flags, ...preset }) => ({
        ...preset,
        active: Object.entries(flags).every(([name, value]) => config.flags[name] === value),
      })),
      font: config.font,
      packs: packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        author: pack.author,
        fileCount: pack.files.length,
        enabled: config.packs[pack.id] !== false,
        conflictsWith:
          config.packs[pack.id] === false
            ? []
            : enabledPacks
                .filter((other) => other.id !== pack.id && other.files.some((file) => pack.files.includes(file)))
                .map((other) => other.name),
      })),
      sync: { state, versionId: install?.versionId, error: this.lastError },
    };
  }

  setEnabled(enabled: boolean): Promise<ModsOverview> {
    return this.change((config) => {
      config.enabled = enabled;
    });
  }

  addFlag(name: string): Promise<ModsOverview> {
    return this.setFlag(name, FLAG_DEFAULTS[flagKind(name)]);
  }

  async setFlag(name: string, value: string): Promise<ModsOverview> {
    const problem = flagValueError(name, value);
    if (problem) throw new Error(problem);
    return this.change((config) => {
      config.flags[name] = value;
    });
  }

  removeFlag(name: string): Promise<ModsOverview> {
    return this.change((config) => {
      delete config.flags[name];
    });
  }

  async setPreset(id: string, active: boolean): Promise<ModsOverview> {
    const preset = MOD_PRESETS.find((item) => item.id === id);
    if (!preset) throw new Error("Unknown preset.");
    return this.change((config) => {
      for (const [name, value] of Object.entries(preset.flags)) {
        if (active) config.flags[name] = value;
        else delete config.flags[name];
      }
    });
  }

  chooseFont(source: string): Promise<ModsOverview> {
    return this.enqueue(async () => {
      const extension = path.extname(source).toLowerCase();
      if (extension !== ".ttf" && extension !== ".otf") throw new PackError("Choose a .ttf or .otf font file.");
      const data = await readFile(source);
      if (!looksLikeFont(data)) throw new PackError("That file isn't a valid font.");

      const name = path.basename(source);
      const previous = this.readConfig().font;
      await mkdir(this.fontsDir, { recursive: true });
      await copyFile(source, path.join(this.fontsDir, name));
      if (previous && previous !== name) await rm(path.join(this.fontsDir, previous), { force: true });

      const config = this.readConfig();
      config.font = name;
      await this.writeConfig(config);
      await this.syncCurrent();
      return this.buildOverview();
    });
  }

  clearFont(): Promise<ModsOverview> {
    return this.enqueue(async () => {
      const config = this.readConfig();
      if (config.font) await rm(path.join(this.fontsDir, config.font), { force: true });
      config.font = null;
      await this.writeConfig(config);
      await this.syncCurrent();
      return this.buildOverview();
    });
  }

  /** Accepts a .zip, or the manifest.json inside a pack folder. */
  importPack(file: string): Promise<ModsOverview> {
    return this.enqueue(async () => {
      await mkdir(this.packsRoot, { recursive: true });
      let id: string;
      if (file.toLowerCase().endsWith(".zip")) {
        if ((await stat(file)).size > PACK_LIMITS.maxTotalBytes) throw new PackError("This pack is too large.");
        id = (await importPackFromZip(await readFile(file), this.packsRoot, this.deps.platform)).id;
      } else if (path.basename(file).toLowerCase() === "manifest.json") {
        id = (await importPackFromFolder(path.dirname(file), this.packsRoot, this.deps.platform)).id;
      } else {
        throw new PackError("Choose a .zip file, or the manifest.json inside a mod pack folder.");
      }

      const config = this.readConfig();
      config.packs[id] = true;
      await this.writeConfig(config);
      await this.syncCurrent();
      return this.buildOverview();
    });
  }

  setPackEnabled(id: string, enabled: boolean): Promise<ModsOverview> {
    return this.change((config) => {
      config.packs[id] = enabled;
    });
  }

  removePack(id: string): Promise<ModsOverview> {
    return this.enqueue(async () => {
      await removePack(id, this.packsRoot);
      const config = this.readConfig();
      delete config.packs[id];
      await this.writeConfig(config);
      await this.syncCurrent();
      return this.buildOverview();
    });
  }

  /**
   * Call only when no game is running. Reapplies mods if Roblox updated, and
   * restarts Roblox's background process if it holds outdated FFlags. Returns
   * a warning instead of failing, since a broken mod shouldn't stop someone playing.
   */
  prepareLaunch(install: RobloxInstall): Promise<string | null> {
    return this.enqueue(async () => {
      try {
        await this.sync(install);
        this.lastError = undefined;

        const backup = this.backupFor(install);
        if (await flagsNeedRestart(backup)) {
          if (await this.deps.isPlayerRunning()) {
            await this.deps.killPlayers();
            this.deps.log("Mods: restarted Roblox's background process so new FFlags load");
          }
          await clearFlagsNeedRestart(backup);
        }
        return null;
      } catch (err) {
        this.lastError = messageOf(err);
        this.deps.log(`Mods: couldn't apply before launch (${this.lastError})`);
        return this.lastError;
      }
    });
  }
}
