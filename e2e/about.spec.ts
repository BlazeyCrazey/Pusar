import { expect, test, type Page } from "@playwright/test";
import os from "node:os";
import { ipcCalls, launchApp, seedAccount, stubIpc, type RunningApp } from "./launch";

let running: RunningApp;

test.afterEach(async () => {
  await running.cleanup();
});

const openSettings = async (page: Page) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Settings", level: 1 }).waitFor();
};

const about = (page: Page) => page.locator("div").filter({ has: page.getByRole("heading", { name: "About", level: 2 }) }).last();

test("shows the version, and says a run from source doesn't update itself", async () => {
  running = await launchApp();
  const { page } = running;
  await openSettings(page);
  await expect(about(page)).toContainText(/Pusar \d+\.\d+\.\d+/);
  await expect(about(page)).toContainText("This copy of Pusar doesn't update itself.");
  await expect(about(page).getByRole("button", { name: "Check for updates" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: /Get beta updates/ })).toBeDisabled();
});

test("a downloaded update offers a restart, in Settings and the status bar", async () => {
  running = await launchApp();
  const { app, page } = running;
  await stubIpc(app, "update:install", { ok: true, data: true });
  await openSettings(page);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send("update", { state: "ready", version: "9.9.9" });
  });

  await expect(about(page)).toContainText("Pusar 9.9.9 is ready. It installs when you restart Pusar.");
  await page.getByRole("contentinfo").getByRole("button", { name: "Restart to update" }).click();
  await expect.poll(() => ipcCalls(app, "update:install")).toHaveLength(1);
});

test("shows download progress", async () => {
  running = await launchApp();
  const { app, page } = running;
  await openSettings(page);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send("update", { state: "downloading", version: "9.9.9", percent: 42 });
  });
  await expect(about(page)).toContainText("Downloading Pusar 9.9.9 (42%)");
  await expect(page.getByRole("contentinfo").getByRole("button", { name: "Restart to update" })).toHaveCount(0);
});

test("diagnostics leave out account names and the Windows user name", async () => {
  running = await launchApp({ accounts: [seedAccount("a1", "secretplayer", "Secret Player")] });
  const { app, page } = running;
  // Keeps the test from overwriting whatever is on the real clipboard.
  await app.evaluate(({ clipboard }) => {
    const store = globalThis as unknown as { __copied?: string };
    clipboard.writeText = ((text: string) => {
      store.__copied = text;
    }) as typeof clipboard.writeText;
  });
  await openSettings(page);
  await page.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect(page.getByText("Diagnostics copied").first()).toBeVisible();

  const report = await app.evaluate(() => (globalThis as unknown as { __copied?: string }).__copied ?? "");
  expect(report).toContain("Pusar diagnostics");
  expect(report).toContain("Accounts: 1");
  expect(report.toLowerCase()).not.toContain("secretplayer");
  expect(report.toLowerCase()).not.toContain("secret player");
  expect(report.toLowerCase()).not.toContain(`\\users\\${os.userInfo().username.toLowerCase()}\\`);
});
