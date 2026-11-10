import { strToU8, zipSync } from "fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ModsService } from "../src/core/modsService";
import type { RobloxInstall } from "../src/shared/types";

let root: string;
let install: RobloxInstall;
let installs: RobloxInstall[];
let playerRunning: boolean;
let gameRunning: boolean;
let killPlayers: Mock<() => Promise<void>>;
let service: ModsService;

const ORIGINAL_FAMILY = JSON.stringify({ name: "Builder", faces: [{ assetId: "rbxasset://fonts/Builder.otf" }] }, null, "\t");
const CURSOR = "textures/Cursors/ArrowCursor.png";
const TTF = new Uint8Array([0, 1, 0, 0, 9, 9, 9, 9]);

function makeInstall(version: string): RobloxInstall {
  const rootDir = path.join(root, "Versions", version);
  const contentDir = path.join(rootDir, "content");
  mkdirSync(path.join(contentDir, "fonts", "families"), { recursive: true });
  mkdirSync(path.dirname(path.join(contentDir, ...CURSOR.split("/"))), { recursive: true });
  writeFileSync(path.join(contentDir, "fonts", "families", "Builder.json"), ORIGINAL_FAMILY);
  writeFileSync(path.join(contentDir, ...CURSOR.split("/")), "original-cursor");
  return {
    platform: "win32",
    source: "Roblox",
    versionId: version,
    playerPath: path.join(rootDir, "RobloxPlayerBeta.exe"),
    rootDir,
    contentDir,
    clientSettingsFile: path.join(rootDir, "ClientSettings", "ClientAppSettings.json"),
    logsDir: path.join(root, "logs"),
    isProtocolHandler: true,
    hasFontFamilies: true,
    modifiedAt: 1,
  };
}

function writeZip(name: string, id: string, files: Record<string, string>) {
  const zip = zipSync({
    "manifest.json": strToU8(JSON.stringify({ id, name, version: "1.0" })),
    ...Object.fromEntries(Object.entries(files).map(([file, text]) => [`content/${file}`, strToU8(text)])),
  });
  const zipPath = path.join(root, `${id}.zip`);
  writeFileSync(zipPath, zip);
  return zipPath;
}

const flagsOn = (target = install) =>
  existsSync(target.clientSettingsFile) ? (JSON.parse(readFileSync(target.clientSettingsFile, "utf8")) as Record<string, string>) : null;
const cursor = (target = install) => readFileSync(path.join(target.contentDir, ...CURSOR.split("/")), "utf8");

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "pusar-mods-service-"));
  install = makeInstall("version-a");
  installs = [install];
  playerRunning = false;
  gameRunning = false;
  killPlayers = vi.fn(async () => {});
  service = new ModsService({
    dataDir: path.join(root, "data"),
    platform: "win32",
    detectInstalls: async () => installs,
    isPlayerRunning: async () => playerRunning,
    killPlayers,
    canApplyNow: () => !gameRunning,
    log: () => {},
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("FFlags and presets", () => {
  it("applies a preset, reports it active, and removes it cleanly", async () => {
    const on = await service.setPreset("gray-sky", true);
    expect(flagsOn()).toEqual({ FFlagDebugSkyGray: "True" });
    expect(on.presets.find((preset) => preset.id === "gray-sky")).toMatchObject({ active: true, confirmed: true });
    expect(on.sync.state).toBe("applied");

    const off = await service.setPreset("gray-sky", false);
    expect(flagsOn()).toBeNull();
    expect(off.presets.find((preset) => preset.id === "gray-sky")?.active).toBe(false);
  });

  it("marks unproven presets as such", async () => {
    const { presets } = await service.overview();
    expect(presets.filter((preset) => preset.confirmed).map((preset) => preset.id)).toEqual(["gray-sky"]);
  });

  it("adds a flag with a sensible default and lists only what's left", async () => {
    const overview = await service.addFlag("FIntDebugForceMSAASamples");
    expect(overview.flags).toEqual([expect.objectContaining({ name: "FIntDebugForceMSAASamples", value: "0", kind: "int" })]);
    expect(overview.availableFlags.map((flag) => flag.name)).not.toContain("FIntDebugForceMSAASamples");
  });

  it("refuses flags Roblox would ignore, and values of the wrong type", async () => {
    await expect(service.setFlag("FFlagMadeUp", "True")).rejects.toThrow(/allowlist/);
    await expect(service.setFlag("constructor", "True")).rejects.toThrow(/allowlist/);
    await expect(service.setFlag("FFlagDebugSkyGray", "maybe")).rejects.toThrow(/True or False/);
    await expect(service.setFlag("FIntDebugForceMSAASamples", "lots")).rejects.toThrow(/whole number/);
    expect(flagsOn()).toBeNull();
  });

  it("handles quick changes one at a time without losing any", async () => {
    await Promise.all([
      service.setPreset("gray-sky", true),
      service.setPreset("still-grass", true),
      service.setPreset("no-antialiasing", true),
    ]);
    expect(Object.keys(flagsOn()!).sort()).toEqual([
      "FFlagDebugSkyGray",
      "FIntDebugForceMSAASamples",
      "FIntGrassMovementReducedMotionFactor",
    ]);
  });
});

describe("font", () => {
  const fontFile = (name: string, data: Uint8Array = TTF) => {
    const file = path.join(root, name);
    writeFileSync(file, data);
    return file;
  };
  const family = () => readFileSync(path.join(install.contentDir, "fonts", "families", "Builder.json"), "utf8");

  it("applies a font and restores Roblox's exactly when cleared", async () => {
    const overview = await service.chooseFont(fontFile("Comic.ttf"));
    expect(overview.font).toBe("Comic.ttf");
    expect(family()).toContain("PusarCustomFont.ttf");

    await service.clearFont();
    expect(family()).toBe(ORIGINAL_FAMILY);
  });

  it("replaces the previous font", async () => {
    await service.chooseFont(fontFile("One.ttf"));
    await service.chooseFont(fontFile("Two.ttf"));
    expect(existsSync(path.join(root, "data", "mods", "fonts", "One.ttf"))).toBe(false);
    expect((await service.overview()).font).toBe("Two.ttf");
  });

  it("rejects files that aren't fonts, even with the right extension", async () => {
    await expect(service.chooseFont(fontFile("Fake.ttf", strToU8("MZ not a font")))).rejects.toThrow(/valid font/);
    await expect(service.chooseFont(fontFile("Evil.exe"))).rejects.toThrow(/\.ttf or \.otf/);
    expect((await service.overview()).font).toBeNull();
  });
});

describe("mod packs", () => {
  it("imports, applies, disables and removes a pack", async () => {
    const imported = await service.importPack(writeZip("Cursors", "cursors", { [CURSOR]: "modded" }));
    expect(imported.packs).toEqual([expect.objectContaining({ id: "cursors", enabled: true, fileCount: 1 })]);
    expect(cursor()).toBe("modded");

    await service.setPackEnabled("cursors", false);
    expect(cursor()).toBe("original-cursor");

    await service.setPackEnabled("cursors", true);
    expect(cursor()).toBe("modded");

    const removed = await service.removePack("cursors");
    expect(removed.packs).toEqual([]);
    expect(cursor()).toBe("original-cursor");
  });

  it("warns about enabled packs replacing the same file, and the later name wins", async () => {
    await service.importPack(writeZip("Alpha", "alpha", { [CURSOR]: "from-alpha" }));
    const overview = await service.importPack(writeZip("Beta", "beta", { [CURSOR]: "from-beta" }));
    expect(overview.packs.map((pack) => pack.conflictsWith)).toEqual([["Beta"], ["Alpha"]]);
    expect(cursor()).toBe("from-beta");

    const off = await service.setPackEnabled("beta", false);
    expect(off.packs.map((pack) => pack.conflictsWith)).toEqual([[], []]);
    expect(cursor()).toBe("from-alpha");
  });

  it("refuses files that aren't packs", async () => {
    const other = path.join(root, "notes.txt");
    writeFileSync(other, "x");
    await expect(service.importPack(other)).rejects.toThrow(/\.zip/);
  });
});

describe("the master switch", () => {
  it("restores Roblox's files but remembers the choices", async () => {
    await service.setPreset("gray-sky", true);
    await service.importPack(writeZip("Cursors", "cursors", { [CURSOR]: "modded" }));

    const off = await service.setEnabled(false);
    expect(flagsOn()).toBeNull();
    expect(cursor()).toBe("original-cursor");
    expect(off.flags).toHaveLength(1);
    expect(off.packs).toHaveLength(1);

    await service.setEnabled(true);
    expect(flagsOn()).toEqual({ FFlagDebugSkyGray: "True" });
    expect(cursor()).toBe("modded");
  });
});

describe("while a game is running", () => {
  it("saves changes without touching Roblox, then applies them at the next launch", async () => {
    gameRunning = true;
    const overview = await service.setPreset("gray-sky", true);
    expect(flagsOn()).toBeNull();
    expect(overview.sync.state).toBe("pending");

    gameRunning = false;
    await service.prepareLaunch(install);
    expect(flagsOn()).toEqual({ FFlagDebugSkyGray: "True" });
  });
});

describe("Roblox updates", () => {
  it("shows the new version as pending, then reapplies everything at launch", async () => {
    await service.setPreset("gray-sky", true);
    await service.importPack(writeZip("Cursors", "cursors", { [CURSOR]: "modded" }));

    const updated = makeInstall("version-b");
    installs = [updated];
    gameRunning = true;
    expect((await service.overview()).sync).toMatchObject({ state: "pending", versionId: "version-b" });

    gameRunning = false;
    await service.prepareLaunch(updated);
    expect(flagsOn(updated)).toEqual({ FFlagDebugSkyGray: "True" });
    expect(cursor(updated)).toBe("modded");
    expect((await service.overview()).sync).toMatchObject({ state: "applied", versionId: "version-b" });
  });

  it("picks up an update when Pusar opens", async () => {
    await service.setPreset("gray-sky", true);
    const updated = makeInstall("version-b");
    installs = [updated];
    await service.syncOnStartup();
    expect(flagsOn(updated)).toEqual({ FFlagDebugSkyGray: "True" });
  });

  it("repairs a modded file that something overwrote", async () => {
    await service.importPack(writeZip("Cursors", "cursors", { [CURSOR]: "modded" }));
    writeFileSync(path.join(install.contentDir, ...CURSOR.split("/")), "overwritten");
    expect((await service.overview()).sync.state).toBe("pending");
    await service.prepareLaunch(install);
    expect(cursor()).toBe("modded");
  });
});

describe("restarting Roblox's background process", () => {
  it("restarts it once after FFlags change, so they actually load", async () => {
    await service.setPreset("gray-sky", true);
    playerRunning = true;
    await service.prepareLaunch(install);
    expect(killPlayers).toHaveBeenCalledTimes(1);

    await service.prepareLaunch(install);
    expect(killPlayers).toHaveBeenCalledTimes(1);
  });

  it("restarts it when flags are removed too, since it still holds the old ones", async () => {
    await service.setPreset("gray-sky", true);
    await service.prepareLaunch(install);
    await service.setPreset("gray-sky", false);
    playerRunning = true;
    await service.prepareLaunch(install);
    expect(killPlayers).toHaveBeenCalledTimes(1);
  });

  it("leaves it alone when no flags changed", async () => {
    await service.importPack(writeZip("Cursors", "cursors", { [CURSOR]: "modded" }));
    playerRunning = true;
    await service.prepareLaunch(install);
    expect(killPlayers).not.toHaveBeenCalled();
  });

  it("has nothing to restart when Roblox is closed, and doesn't restart later for that change", async () => {
    await service.setPreset("gray-sky", true);
    await service.prepareLaunch(install);
    expect(killPlayers).not.toHaveBeenCalled();
    playerRunning = true;
    await service.prepareLaunch(install);
    expect(killPlayers).not.toHaveBeenCalled();
  });
});

describe("when mods can't be applied", () => {
  it("still lets the game launch, and says why", async () => {
    await service.chooseFont(
      (() => {
        const file = path.join(root, "Font.ttf");
        writeFileSync(file, TTF);
        return file;
      })(),
    );
    const updated = makeInstall("version-b");
    rmSync(path.join(updated.contentDir, "fonts", "families"), { recursive: true });
    installs = [updated];

    const warning = await service.prepareLaunch(updated);
    expect(warning).toContain("No font families folder");
    expect((await service.overview()).sync.error).toContain("No font families folder");
  });

  it("reports when Roblox isn't installed", async () => {
    installs = [];
    expect((await service.overview()).sync.state).toBe("noRoblox");
  });

  it("starts from defaults if the saved choices are damaged", async () => {
    await service.setPreset("gray-sky", true);
    writeFileSync(path.join(root, "data", "mods", "config.json"), "{ broken");
    expect((await service.overview()).flags).toEqual([]);
  });
});
