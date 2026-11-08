import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMacInstalls, findWindowsInstalls, parseHandlerCommand } from "../src/core/install";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "pusar-install-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function touch(file: string, mtimeSec?: number) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "");
  if (mtimeSec) utimesSync(file, mtimeSec, mtimeSec);
}

describe("parseHandlerCommand", () => {
  it("handles quoted and unquoted commands", () => {
    expect(parseHandlerCommand('"C:\\R\\RobloxPlayerBeta.exe" %1')).toBe("C:\\R\\RobloxPlayerBeta.exe");
    expect(parseHandlerCommand("C:\\Bloxstrap\\Bloxstrap.exe -player %1")).toBe("C:\\Bloxstrap\\Bloxstrap.exe");
    expect(parseHandlerCommand(null)).toBeNull();
  });
});

describe("findWindowsInstalls", () => {
  it("finds player versions, skips Studio-only folders, and puts the link handler first", () => {
    const versions = path.join(root, "Roblox", "Versions");
    touch(path.join(versions, "version-aaaa", "RobloxPlayerBeta.exe"), 2_000_000_000);
    touch(path.join(versions, "version-bbbb", "RobloxPlayerBeta.exe"), 1_000_000_000);
    mkdirSync(path.join(versions, "version-bbbb", "content", "fonts", "families"), { recursive: true });
    touch(path.join(versions, "version-cccc", "RobloxStudioBeta.exe"));

    const installs = findWindowsInstalls({
      localAppData: root,
      protocolHandlerCommand: `"${path.join(versions, "version-bbbb", "RobloxPlayerBeta.exe")}" %1`,
    });

    expect(installs.map((i) => i.versionId)).toEqual(["version-bbbb", "version-aaaa"]);
    const [handler] = installs;
    expect(handler).toMatchObject({
      source: "Roblox",
      isProtocolHandler: true,
      hasFontFamilies: true,
      clientSettingsFile: path.join(versions, "version-bbbb", "ClientSettings", "ClientAppSettings.json"),
      logsDir: path.join(root, "Roblox", "logs"),
    });
  });

  it("matches the handler path case-insensitively", () => {
    const exe = path.join(root, "Roblox", "Versions", "version-aaaa", "RobloxPlayerBeta.exe");
    touch(exe);
    const [install] = findWindowsInstalls({ localAppData: root, protocolHandlerCommand: `"${exe.toUpperCase()}" %1` });
    expect(install?.isProtocolHandler).toBe(true);
  });

  it("labels other bootstrappers' copies", () => {
    touch(path.join(root, "Bloxstrap", "Versions", "version-dddd", "RobloxPlayerBeta.exe"));
    expect(findWindowsInstalls({ localAppData: root })[0]?.source).toBe("Bloxstrap");
  });

  it("returns nothing when Roblox is not installed", () => {
    expect(findWindowsInstalls({ localAppData: root })).toEqual([]);
  });
});

describe("findMacInstalls", () => {
  it("finds Roblox.app and reads its version", () => {
    const apps = path.join(root, "Applications");
    const app = path.join(apps, "Roblox.app");
    mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(
      path.join(app, "Contents", "Info.plist"),
      "<plist><dict><key>CFBundleShortVersionString</key>\n<string>0.700.1</string></dict></plist>",
    );

    const [install] = findMacInstalls({ home: root, appDirs: [apps] });
    expect(install).toMatchObject({
      platform: "darwin",
      versionId: "0.700.1",
      playerPath: app,
      contentDir: path.join(app, "Contents", "Resources", "content"),
      clientSettingsFile: path.join(app, "Contents", "MacOS", "ClientSettings", "ClientAppSettings.json"),
      logsDir: path.join(root, "Library", "Logs", "Roblox"),
      hasFontFamilies: false,
    });
  });
});
