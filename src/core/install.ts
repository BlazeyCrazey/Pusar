// Finds Roblox player installs on Windows and macOS.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Platform = "win32" | "darwin";

export interface RobloxInstall {
  platform: Platform;
  /** Who manages this copy: Roblox itself or another bootstrapper. */
  source: string;
  /** `version-<hash>` on Windows, bundle version on macOS. */
  versionId: string | null;
  /** RobloxPlayerBeta.exe (Windows) or Roblox.app (macOS). */
  playerPath: string;
  /** Version folder (Windows) or the .app bundle (macOS). */
  rootDir: string;
  contentDir: string;
  clientSettingsFile: string;
  logsDir: string;
  /** True when roblox-player: links currently open this copy. */
  isProtocolHandler: boolean;
  /** True when content/fonts/families exists, so font mods can apply. */
  hasFontFamilies: boolean;
  modifiedAt: number;
}

/** Version folders managed by other bootstrappers, relative to %LOCALAPPDATA%. */
const WINDOWS_ROOTS: Array<{ dir: string; source: string }> = [
  { dir: "Roblox", source: "Roblox" },
  { dir: "Bloxstrap", source: "Bloxstrap" },
  { dir: "Fishstrap", source: "Fishstrap" },
  { dir: "Voidstrap", source: "Voidstrap" },
  { dir: "Froststrap", source: "Froststrap" },
];

export interface WindowsEnv {
  localAppData: string;
  /** Raw (Default) value of HKCU\Software\Classes\roblox-player\shell\open\command. */
  protocolHandlerCommand?: string | null;
}

/** Pulls the executable path out of a registry command like `"C:\x\y.exe" %1`. */
export function parseHandlerCommand(command: string | null | undefined): string | null {
  if (!command) return null;
  const trimmed = command.trim();
  const quoted = /^"([^"]+)"/.exec(trimmed);
  if (quoted?.[1]) return quoted[1];
  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken || null;
}

function samePath(a: string, b: string, platform: Platform): boolean {
  const na = path.normalize(a);
  const nb = path.normalize(b);
  return platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

export function findWindowsInstalls(env: WindowsEnv): RobloxInstall[] {
  const handlerExe = parseHandlerCommand(env.protocolHandlerCommand);
  const installs: RobloxInstall[] = [];

  for (const root of WINDOWS_ROOTS) {
    const versionsDir = path.join(env.localAppData, root.dir, "Versions");
    if (!existsSync(versionsDir)) continue;

    for (const name of readdirSync(versionsDir)) {
      const rootDir = path.join(versionsDir, name);
      const exe = path.join(rootDir, "RobloxPlayerBeta.exe");
      if (!existsSync(exe)) continue; // Studio-only or half-installed folder

      const contentDir = path.join(rootDir, "content");
      installs.push({
        platform: "win32",
        source: root.source,
        versionId: /^version-[0-9a-f]+$/i.test(name) ? name : null,
        playerPath: exe,
        rootDir,
        contentDir,
        clientSettingsFile: path.join(rootDir, "ClientSettings", "ClientAppSettings.json"),
        logsDir: path.join(env.localAppData, "Roblox", "logs"),
        isProtocolHandler: handlerExe ? samePath(handlerExe, exe, "win32") : false,
        hasFontFamilies: existsSync(path.join(contentDir, "fonts", "families")),
        modifiedAt: statSync(exe).mtimeMs,
      });
    }
  }

  return sortInstalls(installs);
}

export interface MacEnv {
  home: string;
  appDirs?: string[];
}

function readBundleVersion(appPath: string): string | null {
  try {
    const plist = readFileSync(path.join(appPath, "Contents", "Info.plist"), "utf8");
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function findMacInstalls(env: MacEnv): RobloxInstall[] {
  const appDirs = env.appDirs ?? ["/Applications", path.join(env.home, "Applications")];
  const installs: RobloxInstall[] = [];

  for (const dir of appDirs) {
    const app = path.join(dir, "Roblox.app");
    const macosDir = path.join(app, "Contents", "MacOS");
    if (!existsSync(macosDir)) continue;

    const contentDir = path.join(app, "Contents", "Resources", "content");
    installs.push({
      platform: "darwin",
      source: "Roblox",
      versionId: readBundleVersion(app),
      playerPath: app,
      rootDir: app,
      contentDir,
      clientSettingsFile: path.join(macosDir, "ClientSettings", "ClientAppSettings.json"),
      logsDir: path.join(env.home, "Library", "Logs", "Roblox"),
      // macOS has no registry; the copy in /Applications is what links open.
      isProtocolHandler: dir === "/Applications",
      hasFontFamilies: existsSync(path.join(contentDir, "fonts", "families")),
      modifiedAt: statSync(macosDir).mtimeMs,
    });
  }

  return sortInstalls(installs);
}

/** Protocol handler first, then newest. */
function sortInstalls(installs: RobloxInstall[]): RobloxInstall[] {
  return installs.sort((a, b) => {
    if (a.isProtocolHandler !== b.isProtocolHandler) return a.isProtocolHandler ? -1 : 1;
    return b.modifiedAt - a.modifiedAt;
  });
}

export function readWindowsProtocolHandler(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", "HKCU\\Software\\Classes\\roblox-player\\shell\\open\\command", "/ve"],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const match = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(stdout);
        resolve(match?.[1]?.trim() ?? null);
      },
    );
  });
}

export async function detectInstalls(): Promise<RobloxInstall[]> {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return findWindowsInstalls({
      localAppData,
      protocolHandlerCommand: await readWindowsProtocolHandler(),
    });
  }
  if (process.platform === "darwin") {
    return findMacInstalls({ home: os.homedir() });
  }
  return [];
}
