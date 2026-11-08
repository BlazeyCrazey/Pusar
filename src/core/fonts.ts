// Replaces Roblox's UI fonts with a custom font file.
// Roblox maps font families to files in content/fonts/families/*.json; each
// face has an `assetId` like "rbxasset://fonts/BuilderSans-Regular.otf".
// We copy the custom font into content/fonts and point every face at it.
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FontApplyResult } from "../shared/types";
import type { BackupStore } from "./backup";

/** Families we never touch: replacing these breaks non-Latin text and emoji. */
const SKIP_FAMILY = /cjk|fallback|emoji/i;

const CUSTOM_FONT_BASENAME = "PusarCustomFont";

interface FamilyFile {
  name?: string;
  faces?: Array<{ assetId?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export async function applyCustomFont(
  contentDir: string,
  fontFile: string,
  backup: BackupStore,
): Promise<FontApplyResult> {
  const ext = path.extname(fontFile).toLowerCase();
  if (ext !== ".ttf" && ext !== ".otf") {
    throw new Error(`Font must be .ttf or .otf, got "${ext || "no extension"}"`);
  }
  const fontsDir = path.join(contentDir, "fonts");
  const familiesDir = path.join(fontsDir, "families");
  if (!existsSync(familiesDir)) {
    throw new Error(`No font families folder at ${familiesDir}`);
  }

  const fontTarget = path.join(fontsDir, `${CUSTOM_FONT_BASENAME}${ext}`);
  await backup.preserve(fontTarget);
  await copyFile(fontFile, fontTarget);

  const assetId = `rbxasset://fonts/${CUSTOM_FONT_BASENAME}${ext}`;
  const familiesUpdated: string[] = [];
  const familiesSkipped: string[] = [];

  for (const name of (await readdir(familiesDir)).sort()) {
    if (!name.endsWith(".json")) continue;
    if (SKIP_FAMILY.test(name)) {
      familiesSkipped.push(name);
      continue;
    }
    const file = path.join(familiesDir, name);
    let family: FamilyFile;
    try {
      family = JSON.parse(await readFile(file, "utf8")) as FamilyFile;
    } catch {
      familiesSkipped.push(name);
      continue;
    }
    if (!Array.isArray(family.faces) || family.faces.length === 0) {
      familiesSkipped.push(name);
      continue;
    }
    await backup.preserve(file);
    for (const face of family.faces) face.assetId = assetId;
    // Roblox's own files use tab indentation.
    await writeFile(file, JSON.stringify(family, null, "\t"));
    familiesUpdated.push(name);
  }

  return { fontTarget, familiesUpdated, familiesSkipped };
}
