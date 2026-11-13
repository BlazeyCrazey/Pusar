import { describe, expect, it } from "vitest";
import { buildDiagnostics, type DiagnosticsInput } from "../src/core/diagnostics";

function input(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    version: "1.0.0",
    electron: "45.2.3",
    os: "Windows_NT 10.0.26200 x64",
    installs: [{ source: "Roblox", versionId: "version-abc" }],
    settings: { onLaunch: "tray", discordEnabled: true, activeAccountId: "uuid-123", lastPlaceId: "999" },
    mods: { enabled: true, flags: 2, packs: 1, font: false },
    instance: "idle",
    accountCount: 1,
    privateNames: ["CoolPlayer", "Cool Player", "jsmith"],
    log: [],
    ...overrides,
  };
}

describe("buildDiagnostics", () => {
  it("describes the setup", () => {
    const report = buildDiagnostics(input(), new Date("2026-11-12T10:00:00Z"));
    expect(report).toContain("Pusar 1.0.0, Electron 45.2.3, Windows_NT 10.0.26200 x64");
    expect(report).toContain("Roblox: Roblox version-abc");
    expect(report).toContain('onLaunch="tray"');
    expect(report).toContain("Mods: on, 2 FFlags, 1 packs, custom font: no");
    expect(report).toContain("Generated: 2026-11-12T10:00:00.000Z");
  });

  it("leaves out which account and game were last used", () => {
    const report = buildDiagnostics(input());
    expect(report).not.toContain("uuid-123");
    expect(report).not.toContain("lastPlaceId");
  });

  it("blanks out account names wherever they appear, longest first", () => {
    const report = buildDiagnostics(
      input({ log: ["10:00:00  Launch: requesting auth ticket for CoolPlayer", "10:00:01  Login: added cool player as Cool Player"] }),
    );
    expect(report).not.toMatch(/coolplayer|cool player/i);
    expect(report).toContain("auth ticket for <account>");
  });

  it("doesn't blank out a name that's only part of another word", () => {
    const report = buildDiagnostics(input({ privateNames: ["Mod"], log: ["Mods: restarted"] }));
    expect(report).toContain("Mods: restarted");
  });

  it("removes the Windows user name from paths", () => {
    const report = buildDiagnostics(input({ log: ["FFlags: wrote 1 flag(s) to C:\\Users\\jsmith\\AppData\\Local\\Roblox\\x.json"] }));
    expect(report).toContain("C:\\Users\\<user>\\AppData");
    expect(report).not.toContain("jsmith");
  });

  it("never lets a credential through", () => {
    const report = buildDiagnostics(input({ log: ["oops _|WARNING:-DO-NOT-SHARE-THIS.--secret", "roblox-player:1+gameinfo:TICKET123+launchtime:1"] }));
    expect(report).not.toContain("secret");
    expect(report).not.toContain("TICKET123");
  });

  it("copes with no Roblox and unreadable mods", () => {
    const report = buildDiagnostics(input({ installs: [], mods: null }));
    expect(report).toContain("Roblox: none found");
    expect(report).toContain("Mods: couldn't be read");
  });

  it("ignores names too short to blank out safely", () => {
    const report = buildDiagnostics(input({ privateNames: ["a", " "], log: ["a launch"] }));
    expect(report).toContain("a launch");
  });
});
