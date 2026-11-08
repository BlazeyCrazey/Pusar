import { describe, expect, it } from "vitest";
import {
  assertRobloxReachable,
  BLOCKED_MESSAGE,
  checkRobloxReachable,
  describeNetError,
  OFFLINE_MESSAGE,
} from "../src/core/network";

const answers = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));
const failsWith = (code: string) => async () => {
  throw Object.assign(new Error(code), { code });
};

describe("checkRobloxReachable", () => {
  it("is ok when DNS returns a real address", async () => {
    expect(await checkRobloxReachable(answers("128.116.0.1", "2620:2b:e000::1"))).toEqual({ ok: true });
  });

  it.each([
    ["0.0.0.0 and ::", ["0.0.0.0", "::"]],
    ["127.0.0.1", ["127.0.0.1"]],
    ["no addresses", []],
  ])("reports a block when DNS returns %s", async (_label, addresses) => {
    expect(await checkRobloxReachable(answers(...addresses))).toEqual({
      ok: false,
      reason: "blocked",
      message: BLOCKED_MESSAGE,
    });
  });

  it("treats a mix of real and sinkhole addresses as reachable", async () => {
    expect((await checkRobloxReachable(answers("0.0.0.0", "128.116.0.1"))).ok).toBe(true);
  });

  it.each(["ENOTFOUND", "ENOENT", "ETIMEOUT", "ECONNREFUSED"])(
    "reports offline-or-blocked when DNS fails with %s",
    async (code) => {
      expect(await checkRobloxReachable(failsWith(code))).toEqual({
        ok: false,
        reason: "offline",
        message: OFFLINE_MESSAGE,
      });
    },
  );

  it("understands Chromium resolver errors, which carry the code in the message", async () => {
    const chromiumFailure = async () => {
      throw new Error("net::ERR_NAME_NOT_RESOLVED");
    };
    expect(await checkRobloxReachable(chromiumFailure)).toMatchObject({ ok: false, reason: "offline" });
  });

  it("reports other DNS errors with their code", async () => {
    expect(await checkRobloxReachable(failsWith("ESERVFAIL"))).toMatchObject({
      ok: false,
      reason: "error",
      message: expect.stringContaining("ESERVFAIL"),
    });
  });

  it("assertRobloxReachable throws the readable message", async () => {
    await expect(assertRobloxReachable(answers("0.0.0.0"))).rejects.toThrow(BLOCKED_MESSAGE);
    await expect(assertRobloxReachable(answers("128.116.0.1"))).resolves.toBeUndefined();
  });
});

describe("describeNetError", () => {
  it("maps Chromium errors to readable messages", () => {
    expect(describeNetError(new Error("ERR_ADDRESS_INVALID (-108) loading 'https://www.roblox.com/login'"))).toBe(BLOCKED_MESSAGE);
    expect(describeNetError(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'x'"))).toBe(OFFLINE_MESSAGE);
    expect(describeNetError("ERR_INTERNET_DISCONNECTED")).toBe(OFFLINE_MESSAGE);
  });

  it("returns null for errors that aren't network problems", () => {
    expect(describeNetError(new Error("ERR_ABORTED (-3)"))).toBeNull();
    expect(describeNetError(new Error("something else"))).toBeNull();
  });
});
