import { describe, expect, it } from "vitest";
import { redact } from "../src/core/redact";

const COOKIE =
  "_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_ABCDEF0123456789";

describe("redact", () => {
  it("removes a raw .ROBLOSECURITY value anywhere in text", () => {
    const out = redact(`token is ${COOKIE} ok`);
    expect(out).not.toContain("ABCDEF0123456789");
    expect(out).toContain("[REDACTED_COOKIE]");
  });

  it("removes cookie header values", () => {
    expect(redact("Cookie: .ROBLOSECURITY=abc123; other=1")).not.toContain("abc123");
    expect(redact('{"cookie":"secretvalue"}')).not.toContain("secretvalue");
  });

  it("removes the auth ticket from a launch URI but keeps the rest", () => {
    const out = redact("roblox-player:1+launchmode:play+gameinfo:TICKET123+launchtime:1");
    expect(out).toBe("roblox-player:1+launchmode:play+gameinfo:[REDACTED]+launchtime:1");
  });

  it("removes ticket, csrf and bound-auth-token header values", () => {
    const out = redact('rbx-authentication-ticket: T1 x-csrf-token: C1 {"x-bound-auth-token":"v1|a|b|c|d"}');
    expect(out).not.toMatch(/T1|C1|v1\|a/);
  });

  it("leaves ordinary text alone", () => {
    expect(redact("Launch: started Roblox for place 1818")).toBe("Launch: started Roblox for place 1818");
  });
});
