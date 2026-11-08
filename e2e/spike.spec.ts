import { expect, test } from "@playwright/test";
import { launchApp, type RunningApp } from "./launch";

// The M0 panel stays usable until real screens replace it.
test.describe("M0 spike panel", () => {
  let running: RunningApp;

  test.beforeAll(async () => {
    running = await launchApp({ args: ["--spike"], ready: "#detect" });
  });

  test.afterAll(async () => {
    await running.cleanup();
  });

  test("opens from the built app when asked for", async () => {
    await expect(running.page).toHaveTitle(/spike panel/);
    expect(running.page.url()).toBe("pusar://app/spike.html");
  });

  test("still reaches the main process through the bridge", async () => {
    const { page } = running;
    await page.locator("#detect").click();
    await expect(page.locator("#log")).toContainText("Roblox install(s)");
  });

  test("works under the Content Security Policy", () => {
    expect(running.problems).toEqual([]);
  });
});
