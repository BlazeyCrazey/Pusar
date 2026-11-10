import { describe, expect, it } from "vitest";
import {
  findLaunchLink,
  handlerRuns,
  isLaunchLink,
  pusarHandlerCommand,
  robloxHandlerCommand,
} from "../src/core/launchLink";

const REAL_SHAPE =
  "roblox-player:1+launchmode:play+gameinfo:AbC_123-xyz+launchtime:1794110647144+placelauncherurl:https%3A%2F%2Fwww.roblox.com%2FGame%2FPlaceLauncher.ashx%3Frequest%3DRequestGame%26placeId%3D1818+browsertrackerid:1234567890+robloxLocale:en_us+gameLocale:en_us+channel:+LaunchExp:InApp";

describe("isLaunchLink", () => {
  it("accepts a real launch link", () => {
    expect(isLaunchLink(REAL_SHAPE)).toBe(true);
  });

  it.each([
    ["another scheme", "https://evil.example/"],
    ["a similar scheme", "roblox-player2:1+x"],
    ["uppercase scheme", "ROBLOX-PLAYER:1"],
    ["nothing after the scheme", "roblox-player:"],
    ["a space", "roblox-player:1 --gpu-launcher=calc.exe"],
    ["a quote breaking out", 'roblox-player:1" --no-sandbox "'],
    ["a shell metacharacter", "roblox-player:1&calc.exe"],
    ["a pipe", "roblox-player:1|calc"],
    ["a newline", "roblox-player:1\nfoo"],
    ["a command-line option", "--gpu-launcher=calc.exe"],
    ["a huge payload", `roblox-player:${"a".repeat(5000)}`],
  ])("rejects %s", (_label, value) => {
    expect(isLaunchLink(value)).toBe(false);
  });
});

describe("findLaunchLink", () => {
  it("finds the link wherever Chromium put it in the arguments", () => {
    expect(findLaunchLink(["C:\\Pusar.exe", "--flag", "--", REAL_SHAPE])).toBe(REAL_SHAPE);
    expect(findLaunchLink([REAL_SHAPE, "--allow-file-access"])).toBe(REAL_SHAPE);
  });

  it("ignores everything else", () => {
    expect(findLaunchLink(["C:\\Pusar.exe", "--spike"])).toBeNull();
    expect(findLaunchLink(["roblox-player:bad link"])).toBeNull();
  });
});

describe("handler commands", () => {
  const exe = "C:\\Users\\A B\\Pusar\\Pusar.exe";

  it("ends option parsing before the link", () => {
    expect(pusarHandlerCommand(exe)).toBe(`"${exe}" -- "%1"`);
  });

  it("matches the form Roblox's installer writes", () => {
    expect(robloxHandlerCommand("C:\\R\\RobloxPlayerBeta.exe")).toBe('"C:\\R\\RobloxPlayerBeta.exe" %1');
  });

  it("recognizes which program a command runs, ignoring case", () => {
    expect(handlerRuns(pusarHandlerCommand(exe), exe)).toBe(true);
    expect(handlerRuns(pusarHandlerCommand(exe.toUpperCase()), exe)).toBe(true);
    expect(handlerRuns(robloxHandlerCommand("C:\\R\\RobloxPlayerBeta.exe"), exe)).toBe(false);
    expect(handlerRuns(null, exe)).toBe(false);
  });
});
