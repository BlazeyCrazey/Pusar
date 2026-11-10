// Reads and writes ClientAppSettings.json (local FFlag overrides).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FlagKind, FlagStatus } from "../shared/types";
import type { BackupStore } from "./backup";

export type FlagValue = string | number | boolean;
export type FlagMap = Record<string, FlagValue>;

export interface ModPreset {
  id: string;
  label: string;
  description: string;
  confirmed: boolean;
  flags: Record<string, string>;
}

/**
 * Roblox ignores local flags that are not on its allowlist. This is the full
 * list from Roblox's announcement (post last edited 2025-10-16, copied 2026-11-08):
 * https://devforum.roblox.com/t/allowlist-for-local-client-configuration-via-fast-flags/3966569
 */
export const ALLOWED_FLAGS: Record<string, string> = {
  DFIntCSGLevelOfDetailSwitchingDistance: "Mesh detail distance",
  DFIntCSGLevelOfDetailSwitchingDistanceL12: "Mesh detail distance (levels 1-2)",
  DFIntCSGLevelOfDetailSwitchingDistanceL23: "Mesh detail distance (levels 2-3)",
  DFIntCSGLevelOfDetailSwitchingDistanceL34: "Mesh detail distance (levels 3-4)",
  FFlagHandleAltEnterFullscreenManually: "Alt+Enter fullscreen handling",
  DFFlagTextureQualityOverrideEnabled: "Enable the texture quality override",
  DFIntTextureQualityOverride: "Texture quality level",
  FIntDebugForceMSAASamples: "Anti-aliasing samples",
  DFFlagDisableDPIScale: "Disable DPI scaling",
  FFlagDebugGraphicsPreferD3D11: "Prefer Direct3D 11",
  FFlagDebugSkyGray: "Gray sky",
  DFFlagDebugPauseVoxelizer: "Pause the voxelizer",
  DFIntDebugFRMQualityLevelOverride: "Graphics quality level override",
  FIntFRMMaxGrassDistance: "Grass draw distance (max)",
  FIntFRMMinGrassDistance: "Grass draw distance (min)",
  FFlagDebugGraphicsPreferVulkan: "Prefer Vulkan",
  FFlagDebugGraphicsPreferOpenGL: "Prefer OpenGL",
  FIntGrassMovementReducedMotionFactor: "Grass sway amount (0 = still)",
};

export const FLAG_PRESETS: Record<string, { label: string; flags: FlagMap }> = {
  // The gray sky is obvious in almost any game, so it proves Roblox read the file.
  spikeTest: {
    label: "Spike test (gray sky)",
    flags: { FFlagDebugSkyGray: true },
  },
};

export function flagStatus(name: string): FlagStatus {
  return Object.hasOwn(ALLOWED_FLAGS, name) ? "allowed" : "unknown";
}

export function flagKind(name: string): FlagKind {
  if (/^[DS]?FFlag/.test(name)) return "bool";
  if (/^[DS]?F(?:Int|Log)/.test(name)) return "int";
  return "string";
}

/** Returns what's wrong with a flag and value, or null if Roblox will accept them. */
export function flagValueError(name: string, value: string): string | null {
  if (flagStatus(name) !== "allowed") return `${name} isn't on Roblox's allowlist, so Roblox would ignore it.`;
  const kind = flagKind(name);
  if (kind === "bool" && value !== "True" && value !== "False") return `${name} must be True or False.`;
  if (kind === "int" && !/^-?\d{1,10}$/.test(value)) return `${name} must be a whole number.`;
  return null;
}

export const FLAG_DEFAULTS: Record<FlagKind, string> = { bool: "True", int: "0", string: "" };

/**
 * One-click tweaks, all built from allowlisted flags. Being on the allowlist
 * doesn't guarantee a flag does anything (OpenGL didn't, in M0), so only presets
 * seen working in a real game are marked confirmed.
 */
export const MOD_PRESETS: ModPreset[] = [
  {
    id: "gray-sky",
    label: "Gray sky",
    description: "Replaces the sky with flat gray.",
    confirmed: true,
    flags: { FFlagDebugSkyGray: "True" },
  },
  {
    id: "still-grass",
    label: "Still grass",
    description: "Stops grass from swaying.",
    confirmed: false,
    flags: { FIntGrassMovementReducedMotionFactor: "0" },
  },
  {
    id: "no-grass",
    label: "No grass",
    description: "Stops drawing grass, for more FPS.",
    confirmed: false,
    flags: { FIntFRMMinGrassDistance: "0", FIntFRMMaxGrassDistance: "0" },
  },
  {
    id: "low-textures",
    label: "Low textures",
    description: "Uses the lowest texture quality, for more FPS.",
    confirmed: false,
    flags: { DFFlagTextureQualityOverrideEnabled: "True", DFIntTextureQualityOverride: "0" },
  },
  {
    id: "no-antialiasing",
    label: "No anti-aliasing",
    description: "Turns off edge smoothing, for more FPS.",
    confirmed: false,
    flags: { FIntDebugForceMSAASamples: "0" },
  },
];

/** Roblox's own files and Bloxstrap store every value as a string ("True", "60"). */
export function serializeFlagValue(value: FlagValue): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

export async function readFlags(file: string): Promise<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Missing or corrupt: treat as empty. The original is still backed up.
  }
  return {};
}

export async function applyFlags(
  file: string,
  flags: FlagMap,
  backup: BackupStore,
): Promise<Record<string, string>> {
  await backup.preserve(file);
  const merged = await readFlags(file);
  for (const [name, value] of Object.entries(flags)) {
    merged[name] = serializeFlagValue(value);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(merged, null, 2));
  return merged;
}
