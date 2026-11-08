import { describe, expect, it } from "vitest";
import { inputSchemas } from "../src/main/ipc/schemas";
import { IPC_CHANNELS } from "../src/shared/ipc";

describe("IPC input schemas", () => {
  it("covers every channel", () => {
    expect(Object.keys(inputSchemas).sort()).toEqual([...IPC_CHANNELS].sort());
  });

  it("accepts valid input", () => {
    expect(inputSchemas["install:detect"].safeParse(undefined).success).toBe(true);
    expect(inputSchemas["mods:status"].safeParse({ rootDir: "C:\\R\\version-a" }).success).toBe(true);
    expect(
      inputSchemas["launch:place"].safeParse({ accountId: "abc", rootDir: "C:\\R", target: "189707" }).success,
    ).toBe(true);
    expect(inputSchemas["activity:start"].safeParse({ rootDir: "C:\\R" }).success).toBe(true);
  });

  it.each([
    ["mods:status", undefined],
    ["mods:status", {}],
    ["mods:status", { rootDir: 5 }],
    ["mods:status", { rootDir: "" }],
    ["mods:status", { rootDir: "x".repeat(2000) }],
    ["mods:status", { rootDir: "C:\\R", extra: true }],
    ["accounts:remove", { id: "x".repeat(65) }],
    ["launch:place", { accountId: "a", rootDir: "b" }],
    ["launch:place", { accountId: "a", rootDir: "b", target: "t".repeat(3000) }],
    ["activity:start", { rootDir: "a", followExistingLog: "yes" }],
    ["accounts:list", { anything: 1 }],
  ] as const)("rejects %s with %j", (channel, input) => {
    expect(inputSchemas[channel].safeParse(input).success).toBe(false);
  });
});
