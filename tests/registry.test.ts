import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { pusarHandlerCommand, robloxHandlerCommand } from "../src/core/launchLink";
import { registryDefaultValue } from "../src/main/platform/win";

// Uses a throwaway key. Never touches the real roblox-player registration.
const ROOT = `HKCU\\Software\\PusarTest-${process.pid}`;
const KEY = `${ROOT}\\shell\\open\\command`;

describe.runIf(process.platform === "win32")("Windows registry link handler", () => {
  const registry = registryDefaultValue(KEY);

  afterAll(() => {
    execFileSync("reg", ["delete", ROOT, "/f"], { stdio: "ignore" });
  });

  it("reads nothing from a key that doesn't exist", async () => {
    expect(await registry.read()).toBeNull();
  });

  it("stores commands exactly, including quotes, spaces and %1", async () => {
    const pusar = pusarHandlerCommand("C:\\Users\\A B\\AppData\\Local\\Programs\\Pusar\\Pusar.exe");
    await registry.write(pusar);
    expect(await registry.read()).toBe(pusar);

    const roblox = robloxHandlerCommand("C:\\Users\\A B\\AppData\\Local\\Roblox\\Versions\\version-a\\RobloxPlayerBeta.exe");
    await registry.write(roblox);
    expect(await registry.read()).toBe(roblox);
  });
});
