// The report behind "Copy diagnostics": enough to debug a bug report, and safe
// to paste into a public GitHub issue.
import { redact } from "./redact";

export interface DiagnosticsInput {
  version: string;
  electron: string;
  os: string;
  installs: Array<{ source: string; versionId: string | null }>;
  settings: Record<string, unknown>;
  mods: { enabled: boolean; flags: number; packs: number; font: boolean } | null;
  instance: string;
  accountCount: number;
  /** Names to blank out wherever they appear, such as account names and the Windows user name. */
  privateNames: string[];
  log: string[];
}

/** Settings that identify someone rather than describe how Pusar is set up. */
const PRIVATE_SETTINGS = new Set(["activeAccountId", "lastPlaceId"]);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrub(text: string, names: string[]): string {
  let result = redact(text)
    // Windows user folders give away the person's name.
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, "$1<user>");
  // Longest first, so "Player One" goes before "Player".
  const sorted = [...new Set(names.filter((name) => name.trim().length >= 2))].sort((a, b) => b.length - a.length);
  sorted.forEach((name) => {
    result = result.replace(new RegExp(`(?<![\\w])${escape(name)}(?![\\w])`, "gi"), "<account>");
  });
  return result;
}

export function buildDiagnostics(input: DiagnosticsInput, generatedAt = new Date()): string {
  const settings = Object.entries(input.settings)
    .filter(([key]) => !PRIVATE_SETTINGS.has(key))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(", ");
  const installs = input.installs.length
    ? input.installs.map((install) => `${install.source} ${install.versionId ?? "unknown version"}`).join("; ")
    : "none found";
  const mods = input.mods
    ? `${input.mods.enabled ? "on" : "off"}, ${input.mods.flags} FFlags, ${input.mods.packs} packs, custom font: ${input.mods.font ? "yes" : "no"}`
    : "couldn't be read";

  const lines = [
    "Pusar diagnostics",
    `Generated: ${generatedAt.toISOString()}`,
    `Pusar ${input.version}, Electron ${input.electron}, ${input.os}`,
    `Roblox: ${installs}`,
    `Roblox right now: ${input.instance}`,
    `Accounts: ${input.accountCount}`,
    `Settings: ${settings || "defaults"}`,
    `Mods: ${mods}`,
    "",
    `Log (last ${input.log.length} lines):`,
    ...input.log,
  ];
  return scrub(lines.join("\n"), input.privateNames);
}
