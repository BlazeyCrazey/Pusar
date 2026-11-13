import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { launchApp, type RunningApp } from "./launch";

const run = promisify(execFile);
// In plain Node, the electron package exports the path to its binary.
const electronBinary = createRequire(path.resolve("package.json"))("electron") as string;

test.describe("security baseline", () => {
  let running: RunningApp;

  test.beforeAll(async () => {
    running = await launchApp();
  });

  test.afterAll(async () => {
    await running.cleanup();
  });

  test("the UI is served from pusar://, not file://", () => {
    expect(running.page.url()).toBe("pusar://app/index.html");
  });

  test("the renderer process runs in the OS sandbox", async () => {
    const renderers = await running.app.evaluate(({ app }) =>
      app.getAppMetrics().filter((metric) => metric.type === "Tab").map((metric) => metric.sandboxed),
    );
    expect(renderers.length).toBeGreaterThan(0);
    expect(renderers.every(Boolean)).toBe(true);
  });

  test("the bridge is isolated and can't be tampered with", async () => {
    const frozen = await running.page.evaluate(() => Object.isFrozen(window.pusar));
    expect(frozen).toBe(true);
  });

  test("the page has no Node access", async () => {
    const globals = await running.page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(globals).toEqual({ require: "undefined", process: "undefined" });
  });

  test("the bridge exposes only the typed API", async () => {
    const keys = await running.page.evaluate(() => Object.keys(window.pusar).sort());
    expect(keys).toEqual(["invoke", "isDev", "onActivity", "onInstance", "onLog", "onUpdate"]);
  });

  test("responses carry the Content Security Policy", async () => {
    const policy = await running.page.evaluate(async () =>
      (await fetch("/index.html")).headers.get("content-security-policy"),
    );
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
  });

  test("inline scripts don't run", async () => {
    const ran = await running.page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.__injected = true";
      document.head.append(script);
      return "__injected" in window;
    });
    expect(ran).toBe(false);
  });

  test("the page can't reach arbitrary sites", async () => {
    const result = await running.page.evaluate(() =>
      fetch("https://example.com/").then(
        () => "reached",
        () => "blocked",
      ),
    );
    expect(result).toBe("blocked");
  });

  test("the page can't navigate away", async () => {
    await running.page.evaluate(() => {
      window.location.href = "https://example.com/";
    });
    await running.page.waitForTimeout(500);
    expect(running.page.url()).toBe("pusar://app/index.html");
  });

  test("the page can't open new windows", async () => {
    const opened = await running.page.evaluate(() => window.open("https://example.com/") !== null);
    expect(opened).toBe(false);
    const count = await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(count).toBe(1);
  });

  test("unknown IPC channels are refused", async () => {
    const outcome = await running.page.evaluate(() =>
      (window.pusar.invoke as unknown as (c: string) => Promise<unknown>)("app:quit").then(
        () => "accepted",
        (err: Error) => err.message,
      ),
    );
    expect(outcome).toContain("Blocked channel");
  });

  test("invalid IPC input is refused by the main process", async () => {
    const result = await running.page.evaluate(() =>
      (window.pusar.invoke as unknown as (c: string, i: unknown) => Promise<unknown>)("mods:status", { rootDir: 5 }),
    );
    expect(result).toEqual({ ok: false, error: "Invalid input for mods:status" });
  });

  test("session cookies aren't reachable from the page", async () => {
    const cookies = await running.page.evaluate(() => document.cookie);
    expect(cookies).toBe("");
  });
});

test.describe("app lifecycle", () => {
  test("closing the window quits, even with a hidden window open", async () => {
    const running = await launchApp();
    const exited = new Promise<void>((resolve) => running.app.process().once("exit", () => resolve()));

    // Regression test for M0: the hidden Roblox session window kept the app alive.
    await running.app.evaluate(({ BrowserWindow }) => {
      const [panel] = BrowserWindow.getAllWindows();
      new BrowserWindow({ show: false });
      panel!.close();
    });

    await expect(exited).resolves.toBeUndefined();
    await running.cleanup();
  });

  test("a second copy with the same profile exits instead of opening", async () => {
    const running = await launchApp();
    const userData = await running.app.evaluate(({ app }) => app.getPath("userData"));

    // A copy that loses the single-instance lock quits before showing a window,
    // so it's started directly: Playwright can only attach to apps that stay open.
    const { stdout } = await run(electronBinary, [".", `--user-data-dir=${userData}`]);
    expect(stdout).toContain("already running");

    await running.cleanup();
  });
});
