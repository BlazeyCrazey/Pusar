import { strToU8, zipSync } from "fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkContentPath,
  importPackFromFolder,
  importPackFromZip,
  listPacks,
  PackError,
  removePack,
  resolveInContent,
} from "../src/core/modPack";

let root: string;
let packs: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "pusar-pack-"));
  packs = path.join(root, "packs");
  mkdirSync(packs);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const manifest = (extra: object = {}) => JSON.stringify({ id: "cool-pack", name: "Cool Pack", version: "1.0.0", ...extra });
const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
const CURSOR = "textures/Cursors/KeyboardMouse/ArrowCursor.png";

describe("checkContentPath", () => {
  it.each([
    [CURSOR, CURSOR],
    ["fonts/My Font.ttf", "fonts/My Font.ttf"],
    ["sounds/ouch.OGG", "sounds/ouch.OGG"],
    ["textures\\a\\b.png", "textures/a/b.png"],
  ])("accepts %s", (input, expected) => {
    expect(checkContentPath(input)).toBe(expected);
  });

  it.each([
    "../../RobloxPlayerBeta.png",
    "textures/../../../evil.png",
    "..\\..\\evil.png",
    "/etc/evil.png",
    "C:/Windows/evil.png",
    "C:\\Windows\\evil.png",
    "textures//double.png",
    "textures/CON.png",
    "textures/nul",
    "textures/trailing.png.",
    "textures/what?.png",
    "textures/null\u0000.png",
  ])("rejects the unsafe path %s", (input) => {
    expect(() => checkContentPath(input)).toThrow(PackError);
  });

  it.each(["evil.exe", "evil.dll", "evil.bat", "evil.ps1", "evil.lua", "fonts/families/Builder.json", "noextension", "a.png.exe"])(
    "refuses the file type of %s",
    (input) => {
      expect(() => checkContentPath(input)).toThrow(/won't install|unsafe/);
    },
  );
});

describe("resolveInContent", () => {
  it("stays inside the content folder", () => {
    const content = path.resolve("/roblox/content");
    expect(resolveInContent(content, CURSOR)).toBe(path.join(content, ...CURSOR.split("/")));
    expect(() => resolveInContent(content, "../outside.png")).toThrow(PackError);
  });
});

describe("importPackFromZip", () => {
  it("installs a valid pack", async () => {
    await importPackFromZip(zip({ "manifest.json": manifest(), [`content/${CURSOR}`]: "cursor" }), packs, "win32");
    const [pack] = await listPacks(packs, "win32");
    expect(pack).toMatchObject({ id: "cool-pack", name: "Cool Pack", version: "1.0.0", files: [CURSOR] });
    expect(readFileSync(path.join(pack!.dir, "content", ...CURSOR.split("/")), "utf8")).toBe("cursor");
  });

  it("accepts a pack inside one top-level folder, like a GitHub download", async () => {
    await importPackFromZip(zip({ "cool-pack-main/manifest.json": manifest(), [`cool-pack-main/content/${CURSOR}`]: "c" }), packs, "win32");
    expect((await listPacks(packs, "win32"))[0]?.files).toEqual([CURSOR]);
  });

  it("ignores files outside content/, like a README", async () => {
    await importPackFromZip(zip({ "manifest.json": manifest(), "README.md": "hi", "evil.exe": "x", [`content/${CURSOR}`]: "c" }), packs, "win32");
    const [pack] = await listPacks(packs, "win32");
    expect(pack!.files).toEqual([CURSOR]);
    expect(existsSync(path.join(pack!.dir, "evil.exe"))).toBe(false);
  });

  it("rejects a zip-slip path and writes nothing", async () => {
    const bad = zip({ "manifest.json": manifest(), "content/../../../evil.png": "x" });
    // The path no longer starts with content/ once normalized, so build one that does.
    const worse = zip({ "manifest.json": manifest(), "content/textures/../../../evil.png": "x" });
    await expect(importPackFromZip(worse, packs, "win32")).rejects.toThrow(/unsafe/);
    await expect(importPackFromZip(bad, packs, "win32")).rejects.toThrow();
    expect(await listPacks(packs, "win32")).toEqual([]);
    expect(existsSync(path.join(root, "evil.png"))).toBe(false);
  });

  it("rejects executables inside content/", async () => {
    await expect(importPackFromZip(zip({ "manifest.json": manifest(), "content/run.exe": "MZ" }), packs, "win32")).rejects.toThrow(/won't install/);
  });

  it.each([
    ["path traversal", { id: "../../evil" }],
    ["separators", { id: "a/b" }],
    ["uppercase", { id: "Cool" }],
    ["a trailing dot", { id: "cool." }],
    ["an empty name", { name: "" }],
    ["no version", { version: "" }],
  ])("rejects a manifest with %s", async (_label, change) => {
    await expect(importPackFromZip(zip({ "manifest.json": manifest(change), [`content/${CURSOR}`]: "c" }), packs, "win32")).rejects.toThrow(/valid id/);
  });

  it("rejects a pack for another operating system", async () => {
    await expect(
      importPackFromZip(zip({ "manifest.json": manifest({ platforms: ["darwin"] }), [`content/${CURSOR}`]: "c" }), packs, "win32"),
    ).rejects.toThrow(/doesn't support/);
  });

  it("explains missing pieces", async () => {
    await expect(importPackFromZip(zip({ [`content/${CURSOR}`]: "c" }), packs, "win32")).rejects.toThrow(/no manifest/);
    await expect(importPackFromZip(zip({ "manifest.json": manifest() }), packs, "win32")).rejects.toThrow(/no files/);
    await expect(importPackFromZip(strToU8("not a zip"), packs, "win32")).rejects.toThrow(/valid zip/);
  });

  it("rejects too many files", async () => {
    const files: Record<string, string> = { "manifest.json": manifest() };
    for (let i = 0; i < 2001; i++) files[`content/textures/${i}.png`] = "x";
    await expect(importPackFromZip(zip(files), packs, "win32")).rejects.toThrow(/too many/);
  });

  it("upgrades in place, and a failed upgrade leaves the old pack working", async () => {
    await importPackFromZip(zip({ "manifest.json": manifest(), [`content/${CURSOR}`]: "v1" }), packs, "win32");
    await expect(importPackFromZip(zip({ "manifest.json": manifest({ version: "2.0.0" }), "content/bad.exe": "x" }), packs, "win32")).rejects.toThrow();
    expect((await listPacks(packs, "win32"))[0]?.version).toBe("1.0.0");

    await importPackFromZip(zip({ "manifest.json": manifest({ version: "2.0.0" }), "content/sounds/new.ogg": "v2" }), packs, "win32");
    const all = await listPacks(packs, "win32");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ version: "2.0.0", files: ["sounds/new.ogg"] });
  });

  it("gives different content a different hash", async () => {
    await importPackFromZip(zip({ "manifest.json": manifest(), [`content/${CURSOR}`]: "one" }), packs, "win32");
    const first = (await listPacks(packs, "win32"))[0]!.contentHash;
    await importPackFromZip(zip({ "manifest.json": manifest(), [`content/${CURSOR}`]: "two" }), packs, "win32");
    expect((await listPacks(packs, "win32"))[0]!.contentHash).not.toBe(first);
  });
});

describe("importPackFromFolder", () => {
  function makeFolder(files: Record<string, string>) {
    const folder = path.join(root, "source");
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(folder, ...name.split("/"));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    return folder;
  }

  it("installs a valid folder", async () => {
    await importPackFromFolder(makeFolder({ "manifest.json": manifest(), [`content/${CURSOR}`]: "c" }), packs, "win32");
    expect((await listPacks(packs, "win32"))[0]?.files).toEqual([CURSOR]);
  });

  it("rejects disallowed files", async () => {
    await expect(importPackFromFolder(makeFolder({ "manifest.json": manifest(), "content/a.dll": "x" }), packs, "win32")).rejects.toThrow(/won't install/);
  });

  it("explains a folder that isn't a pack", async () => {
    await expect(importPackFromFolder(makeFolder({ "readme.txt": "x" }), packs, "win32")).rejects.toThrow(/no manifest/);
    await expect(importPackFromFolder(makeFolder({ "manifest.json": manifest() }), packs, "win32")).rejects.toThrow(/no content/);
  });

  it("rejects links that could point anywhere on the PC", async (context) => {
    const folder = makeFolder({ "manifest.json": manifest(), [`content/${CURSOR}`]: "c" });
    const secret = path.join(root, "secret.png");
    writeFileSync(secret, "private");
    try {
      symlinkSync(secret, path.join(folder, "content", "link.png"));
    } catch {
      context.skip(); // Creating links needs extra rights on Windows.
    }
    await expect(importPackFromFolder(folder, packs, "win32")).rejects.toThrow(/link/);
  });
});

describe("listPacks and removePack", () => {
  it("leaves out a damaged pack instead of failing", async () => {
    await importPackFromZip(zip({ "manifest.json": manifest(), [`content/${CURSOR}`]: "c" }), packs, "win32");
    mkdirSync(path.join(packs, "broken"));
    writeFileSync(path.join(packs, "broken", "manifest.json"), "{");
    expect((await listPacks(packs, "win32")).map((pack) => pack.id)).toEqual(["cool-pack"]);
  });

  it("returns nothing when no packs exist yet", async () => {
    expect(await listPacks(path.join(root, "missing"), "win32")).toEqual([]);
  });

  it("removes a pack but refuses paths", async () => {
    await importPackFromZip(zip({ "manifest.json": manifest(), [`content/${CURSOR}`]: "c" }), packs, "win32");
    await removePack("cool-pack", packs);
    expect(await listPacks(packs, "win32")).toEqual([]);
    await expect(removePack("../../", packs)).rejects.toThrow(PackError);
  });
});
