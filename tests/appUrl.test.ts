import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, contentTypeFor, isAppUrl, resolveAppFile } from "../src/core/appUrl";

describe("isAppUrl", () => {
  it("accepts Pusar's own origin", () => {
    expect(isAppUrl("pusar://app/index.html")).toBe(true);
    expect(isAppUrl("pusar://app/assets/x.js?y=1")).toBe(true);
  });

  it.each([
    "https://www.roblox.com/",
    "file:///C:/Windows/system32/calc.exe",
    "pusar://evil/index.html",
    "pusar://app.evil.com/",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isAppUrl(url)).toBe(false);
  });

  it("only trusts the dev server when one is given", () => {
    const dev = "http://localhost:5173";
    expect(isAppUrl("http://localhost:5173/index.html")).toBe(false);
    expect(isAppUrl("http://localhost:5173/index.html", dev)).toBe(true);
    expect(isAppUrl("http://localhost:9999/index.html", dev)).toBe(false);
    expect(isAppUrl("http://localhost:5173.evil.com/", dev)).toBe(false);
  });

  it("survives a malformed dev server value", () => {
    expect(isAppUrl("http://localhost:5173/", "nonsense")).toBe(false);
  });
});

describe("resolveAppFile", () => {
  const root = path.resolve("/app/renderer");

  it("maps paths inside the root", () => {
    expect(resolveAppFile(root, "/index.html")).toBe(path.join(root, "index.html"));
    expect(resolveAppFile(root, "/assets/a%20b.js")).toBe(path.join(root, "assets", "a b.js"));
  });

  it("serves index.html for the root path", () => {
    expect(resolveAppFile(root, "/")).toBe(path.join(root, "index.html"));
  });

  it.each([
    "/../secrets.txt",
    "/assets/../../secrets.txt",
    "/%2e%2e/secrets.txt",
    "/..%2fsecrets.txt",
    "/..%5csecrets.txt",
    "/C:/Windows/win.ini",
    "/%E0%A4%A",
  ])("refuses to escape the root: %s", (pathname) => {
    expect(resolveAppFile(root, pathname)).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("knows the files the UI uses, and is case-insensitive", () => {
    expect(contentTypeFor("a.html")).toContain("text/html");
    expect(contentTypeFor("a.JS")).toContain("javascript");
    expect(contentTypeFor("a.woff2")).toBe("font/woff2");
  });

  it("never guesses an unknown type as something executable", () => {
    expect(contentTypeFor("a.exe")).toBe("application/octet-stream");
  });
});

describe("Content Security Policy", () => {
  const directive = (name: string) =>
    CONTENT_SECURITY_POLICY.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

  it("denies by default", () => {
    expect(directive("default-src")).toBe("default-src 'none'");
  });

  it("never allows inline or eval scripts", () => {
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it("only talks to its own origin", () => {
    expect(directive("connect-src")).toBe("connect-src 'self'");
  });
});
