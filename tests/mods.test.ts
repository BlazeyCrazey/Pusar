import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackupStore } from "../src/core/backup";
import { applyFlags, flagStatus, readFlags, serializeFlagValue } from "../src/core/fflags";
import { applyCustomFont } from "../src/core/fonts";

let root: string;
let backup: BackupStore;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "pusar-mods-"));
  backup = new BackupStore(path.join(root, "backup"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const family = (name: string, file: string) =>
  JSON.stringify({ name, faces: [{ name: "Regular", weight: 400, style: "normal", assetId: `rbxasset://fonts/${file}` }] }, null, "\t");

describe("FFlags", () => {
  const flagsFile = () => path.join(root, "install", "ClientSettings", "ClientAppSettings.json");

  it("serializes values the way Roblox's files do", () => {
    expect(serializeFlagValue(true)).toBe("True");
    expect(serializeFlagValue(false)).toBe("False");
    expect(serializeFlagValue(60)).toBe("60");
  });

  it("creates the file when missing, and revert deletes it", async () => {
    await applyFlags(flagsFile(), { FIntGrassMovementReducedMotionFactor: 0 }, backup);
    expect(await readFlags(flagsFile())).toEqual({ FIntGrassMovementReducedMotionFactor: "0" });
    expect(await backup.restoreAll()).toEqual({ restored: 0, removed: 1 });
    expect(existsSync(flagsFile())).toBe(false);
  });

  it("merges into existing flags, and revert restores the original exactly", async () => {
    mkdirSync(path.dirname(flagsFile()), { recursive: true });
    const original = '{"ExistingFlag":"True"}';
    writeFileSync(flagsFile(), original);

    await applyFlags(flagsFile(), { FFlagDebugGraphicsPreferOpenGL: true }, backup);
    await applyFlags(flagsFile(), { FIntGrassMovementReducedMotionFactor: 0 }, backup);
    expect(await readFlags(flagsFile())).toEqual({
      ExistingFlag: "True",
      FFlagDebugGraphicsPreferOpenGL: "True",
      FIntGrassMovementReducedMotionFactor: "0",
    });

    await backup.restoreAll();
    expect(readFileSync(flagsFile(), "utf8")).toBe(original);
  });

  it("treats a corrupt file as empty but still restores it", async () => {
    mkdirSync(path.dirname(flagsFile()), { recursive: true });
    writeFileSync(flagsFile(), "{not json");
    await applyFlags(flagsFile(), { A: 1 }, backup);
    expect(await readFlags(flagsFile())).toEqual({ A: "1" });
    await backup.restoreAll();
    expect(readFileSync(flagsFile(), "utf8")).toBe("{not json");
  });

  it("classifies flags against the allowlist", () => {
    expect(flagStatus("FFlagDebugSkyGray")).toBe("allowed");
    expect(flagStatus("FIntRenderGrassDetailStrands")).toBe("unknown");
    expect(flagStatus("DFIntMadeUpFlag")).toBe("unknown");
    // Object prototype names are not flags.
    expect(flagStatus("constructor")).toBe("unknown");
  });
});

describe("custom font", () => {
  function makeContent() {
    const content = path.join(root, "content");
    const families = path.join(content, "fonts", "families");
    mkdirSync(families, { recursive: true });
    writeFileSync(path.join(families, "BuilderSans.json"), family("Builder Sans", "BuilderSans-Regular.otf"));
    writeFileSync(path.join(families, "NotoSansCJKFallback.json"), family("Noto CJK", "Noto.otf"));
    writeFileSync(path.join(families, "Broken.json"), "{");
    const font = path.join(root, "My Font.ttf");
    writeFileSync(font, "font-bytes");
    return { content, families, font };
  }

  it("points every safe family at the custom font and skips CJK/broken ones", async () => {
    const { content, families, font } = makeContent();
    const result = await applyCustomFont(content, font, backup);

    expect(result.familiesUpdated).toEqual(["BuilderSans.json"]);
    expect(result.familiesSkipped.sort()).toEqual(["Broken.json", "NotoSansCJKFallback.json"]);
    expect(readFileSync(result.fontTarget, "utf8")).toBe("font-bytes");
    const builder = JSON.parse(readFileSync(path.join(families, "BuilderSans.json"), "utf8"));
    expect(builder.faces[0].assetId).toBe("rbxasset://fonts/PusarCustomFont.ttf");
  });

  it("reverts to Roblox's original files byte for byte", async () => {
    const { content, families, font } = makeContent();
    const before = readFileSync(path.join(families, "BuilderSans.json"), "utf8");
    const result = await applyCustomFont(content, font, backup);
    await backup.restoreAll();

    expect(readFileSync(path.join(families, "BuilderSans.json"), "utf8")).toBe(before);
    expect(existsSync(result.fontTarget)).toBe(false);
  });

  it("keeps the true original when a font is applied twice", async () => {
    const { content, families, font } = makeContent();
    const before = readFileSync(path.join(families, "BuilderSans.json"), "utf8");
    await applyCustomFont(content, font, backup);
    await applyCustomFont(content, font, backup);
    await backup.restoreAll();
    expect(readFileSync(path.join(families, "BuilderSans.json"), "utf8")).toBe(before);
  });

  it("rejects non-font files", async () => {
    const { content } = makeContent();
    const bad = path.join(root, "evil.exe");
    writeFileSync(bad, "");
    await expect(applyCustomFont(content, bad, backup)).rejects.toThrow(/\.ttf or \.otf/);
  });
});

describe("BackupStore.forInstall", () => {
  it("gives each install its own folder", () => {
    const a = BackupStore.forInstall(root, "C:\\R\\version-a");
    const b = BackupStore.forInstall(root, "C:\\R\\version-b");
    expect(a.dir).not.toBe(b.dir);
    expect(BackupStore.forInstall(root, "C:\\R\\version-a").dir).toBe(a.dir);
  });
});
