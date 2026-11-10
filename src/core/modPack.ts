// Imports mod packs. A pack is a folder or zip holding manifest.json plus a
// content/ folder that mirrors Roblox's own content folder.
//
// Packs are downloaded from strangers, so nothing in one is trusted: only known
// asset types are accepted, and no path may leave Roblox's content folder.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import type { Platform } from "../shared/types";

const MIB = 1024 * 1024;

export const PACK_LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 64 * MIB,
  maxTotalBytes: 256 * MIB,
  maxZipEntries: 10_000,
  maxManifestBytes: 64 * 1024,
};

/** Images, fonts and sounds only. Nothing that can run, or that Roblox reads as settings. */
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".ttf", ".otf", ".ogg", ".mp3", ".wav"]);

const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const hasBadCharacter = (text: string) => /[<>:"|?*]/.test(text) || [...text].some((character) => character.charCodeAt(0) < 32);

/** Thrown with a message written for the person importing the pack. */
export class PackError extends Error {}

const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/),
  name: z.string().trim().min(1).max(80),
  version: z.string().trim().min(1).max(32),
  author: z.string().trim().max(80).optional(),
  platforms: z.array(z.enum(["win32", "darwin"])).optional(),
});

export type PackManifest = z.infer<typeof manifestSchema>;

export interface InstalledPack extends PackManifest {
  dir: string;
  contentHash: string;
  /** Paths relative to content/, with forward slashes. */
  files: string[];
}

const PACK_INFO_FILE = ".pusar-pack.json";

/** Normalizes a path inside content/, or throws if it could escape or isn't allowed. */
export function checkContentPath(raw: string): string {
  const normalized = raw.replaceAll("\\", "/");
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      hasBadCharacter(segment) ||
      RESERVED_NAME.test(segment) ||
      /[. ]$/.test(segment)
    ) {
      throw new PackError(`This pack has an unsafe file path: ${raw}`);
    }
  }
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new PackError(`This pack has a file type Pusar won't install: ${path.posix.basename(normalized)}`);
  }
  return normalized;
}

/** The full path of a pack file inside `contentDir`, or throws if it would land outside. */
export function resolveInContent(contentDir: string, relativePath: string): string {
  const full = path.resolve(contentDir, checkContentPath(relativePath));
  const fromRoot = path.relative(contentDir, full);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new PackError(`This pack has an unsafe file path: ${relativePath}`);
  }
  return full;
}

function parseManifest(text: string, platform: Platform): PackManifest {
  let parsed: PackManifest;
  try {
    parsed = manifestSchema.parse(JSON.parse(text));
  } catch {
    throw new PackError("This pack's manifest.json is missing a valid id, name or version.");
  }
  if (parsed.platforms && !parsed.platforms.includes(platform)) {
    throw new PackError(`${parsed.name} doesn't support this operating system.`);
  }
  return parsed;
}

function checkEntries(entries: Array<{ path: string; size: number }>): void {
  if (entries.length === 0) throw new PackError("This pack has no files in its content folder.");
  if (entries.length > PACK_LIMITS.maxFiles) throw new PackError("This pack has too many files.");
  let total = 0;
  for (const entry of entries) {
    if (entry.size > PACK_LIMITS.maxFileBytes) throw new PackError(`This file is too large: ${entry.path}`);
    total += entry.size;
  }
  if (total > PACK_LIMITS.maxTotalBytes) throw new PackError("This pack is too large.");
}

/** Writes to a temporary folder first, so a failed import can't damage an installed pack. */
async function installPack(
  manifestText: string,
  manifest: PackManifest,
  files: Array<{ path: string; data: Uint8Array }>,
  packsRoot: string,
): Promise<void> {
  const temp = path.join(packsRoot, `.importing-${randomUUID()}`);
  try {
    const hash = createHash("sha256");
    for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
      hash.update(file.path).update(file.data);
      const target = path.join(temp, "content", ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.data);
    }
    await writeFile(path.join(temp, "manifest.json"), manifestText);
    await writeFile(
      path.join(temp, PACK_INFO_FILE),
      JSON.stringify({ contentHash: hash.digest("hex"), files: files.map((file) => file.path) }),
    );
    const final = path.join(packsRoot, manifest.id);
    await rm(final, { recursive: true, force: true });
    await rename(temp, final);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function importPackFromFolder(folder: string, packsRoot: string, platform: Platform): Promise<PackManifest> {
  let manifestText: string;
  try {
    manifestText = await readFile(path.join(folder, "manifest.json"), "utf8");
  } catch {
    throw new PackError("That folder has no manifest.json.");
  }
  const manifest = parseManifest(manifestText, platform);

  const contentRoot = path.join(folder, "content");
  if (!existsSync(contentRoot)) throw new PackError("This pack has no content folder.");

  const found: Array<{ path: string; size: number; source: string }> = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A link could point anywhere on the PC.
      const info = await lstat(source);
      if (info.isSymbolicLink()) throw new PackError(`This pack contains a shortcut link: ${relative}`);
      if (info.isDirectory()) await walk(source, relative);
      else found.push({ path: checkContentPath(relative), size: info.size, source });
    }
  };
  await walk(contentRoot, "");
  checkEntries(found);

  const files = await Promise.all(found.map(async (file) => ({ path: file.path, data: await readFile(file.source) })));
  await installPack(manifestText, manifest, files, packsRoot);
  return manifest;
}

export async function importPackFromZip(zip: Uint8Array, packsRoot: string, platform: Platform): Promise<PackManifest> {
  // First pass reads names and declared sizes only, so nothing large is unpacked until it's all been checked.
  const listing: Array<{ name: string; size: number }> = [];
  try {
    unzipSync(zip, {
      filter: (file) => {
        if (listing.length >= PACK_LIMITS.maxZipEntries) throw new PackError("This pack has too many files.");
        if (!file.name.endsWith("/")) listing.push({ name: file.name, size: file.originalSize });
        return false;
      },
    });
  } catch (err) {
    if (err instanceof PackError) throw err;
    throw new PackError("That file isn't a valid zip.");
  }

  // The manifest may sit at the top, or inside one folder (as in a GitHub download).
  const manifests = listing
    .filter((file) => /^(?:[^/\\]+[/\\])?manifest\.json$/.test(file.name))
    .sort((a, b) => a.name.length - b.name.length);
  const manifestEntry = manifests[0];
  if (!manifestEntry) throw new PackError("That zip has no manifest.json.");
  if (manifestEntry.size > PACK_LIMITS.maxManifestBytes) throw new PackError("This pack's manifest.json is too large.");
  const prefix = manifestEntry.name.slice(0, -"manifest.json".length).replaceAll("\\", "/");
  const contentPrefix = `${prefix}content/`;

  const wanted = new Map<string, string>();
  const entries: Array<{ path: string; size: number }> = [];
  for (const file of listing) {
    const name = file.name.replaceAll("\\", "/");
    if (!name.startsWith(contentPrefix)) continue;
    const relative = checkContentPath(name.slice(contentPrefix.length));
    wanted.set(file.name, relative);
    entries.push({ path: relative, size: file.size });
  }
  checkEntries(entries);

  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(zip, { filter: (file) => wanted.has(file.name) || file.name === manifestEntry.name });
  } catch {
    throw new PackError("That zip is damaged and couldn't be read.");
  }

  const manifestData = unpacked[manifestEntry.name];
  if (!manifestData) throw new PackError("That zip has no manifest.json.");
  const manifestText = new TextDecoder().decode(manifestData);
  const manifest = parseManifest(manifestText, platform);

  const files = [...wanted].map(([name, relative]) => {
    const data = unpacked[name];
    // The sizes checked above were only what the zip claimed.
    if (!data || data.length > PACK_LIMITS.maxFileBytes) throw new PackError(`This file is too large: ${relative}`);
    return { path: relative, data };
  });
  await installPack(manifestText, manifest, files, packsRoot);
  return manifest;
}

export async function listPacks(packsRoot: string, platform: Platform): Promise<InstalledPack[]> {
  let names: string[];
  try {
    names = await readdir(packsRoot);
  } catch {
    return [];
  }
  const packs: InstalledPack[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const dir = path.join(packsRoot, name);
    try {
      const manifest = parseManifest(await readFile(path.join(dir, "manifest.json"), "utf8"), platform);
      const info = JSON.parse(await readFile(path.join(dir, PACK_INFO_FILE), "utf8")) as {
        contentHash: string;
        files: string[];
      };
      packs.push({ ...manifest, dir, contentHash: info.contentHash, files: info.files });
    } catch {
      // A damaged pack is left out instead of breaking every other mod.
    }
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function removePack(id: string, packsRoot: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new PackError("Unknown pack.");
  await rm(path.join(packsRoot, id), { recursive: true, force: true });
}
