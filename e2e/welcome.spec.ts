import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { launchApp, seedAccount, stubIpc, type RunningApp } from "./launch";

let running: RunningApp;

test.afterEach(async () => {
  await running.cleanup();
});

const setup = (page: Page) => page.getByRole("heading", { name: "Set up Pusar", level: 1 });
const step = (page: Page, name: RegExp) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
const prefs = (userData: string) => {
  const file = path.join(userData, "prefs.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
};

test("a brand new user starts with setup, and finishing it lands on Play for good", async () => {
  running = await launchApp({ firstRun: true });
  const { page, userData, problems } = running;
  await expect(setup(page)).toBeVisible();
  await expect(step(page, /^Roblox/)).toContainText("Found Roblox e2e00000.");
  await expect(step(page, /^Roblox/).getByRole("heading")).toHaveText("Roblox (done)");

  await page.getByRole("button", { name: "Start using Pusar" }).click();
  await expect(page.getByRole("heading", { name: "Play", level: 1 })).toBeAttached();
  expect(prefs(userData).onboarded).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Play", level: 1 })).toBeAttached();
  await expect(setup(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("adding an account from setup marks that step done", async () => {
  running = await launchApp({ firstRun: true });
  const { app, page } = running;
  const account = seedAccount("a1", "player", "Player One");
  await stubIpc(app, "accounts:add", { ok: true, data: { account } });
  await stubIpc(app, "accounts:overview", { ok: true, data: { accounts: [account], activeAccountId: "a1" } });

  await step(page, /Your Roblox account/).getByRole("button", { name: "Add account" }).click();
  await expect(step(page, /Your Roblox account/)).toContainText("Signed in as Player One.");
  await expect(step(page, /Your Roblox account/).getByRole("button")).toHaveCount(0);
});

test("the Discord step saves the same setting as Settings", async () => {
  running = await launchApp({ firstRun: true });
  const { page, userData } = running;
  await step(page, /^Discord/).getByRole("switch").click();
  await expect.poll(() => prefs(userData).discordEnabled).toBe(true);
  await expect(step(page, /^Discord/).getByRole("heading")).toHaveText("Discord (done)");
});

test("without Roblox, setup says so and can check again", async () => {
  running = await launchApp({ firstRun: true, robloxMissing: true });
  const { page } = running;
  await expect(step(page, /^Roblox/)).toContainText("Roblox isn't installed yet.");
  await step(page, /^Roblox/).getByRole("button", { name: "Check again" }).click();
  await expect(step(page, /^Roblox/).getByRole("button", { name: "Check again" })).toBeEnabled();
});

test("someone who already has an account skips setup", async () => {
  running = await launchApp({ firstRun: true, accounts: [seedAccount("a1", "player")] });
  const { page } = running;
  await expect(page.getByRole("heading", { name: "Play", level: 1 })).toBeAttached();
  await expect(setup(page)).toHaveCount(0);
});

test("leaving setup through the menu still works, and it returns next time", async () => {
  running = await launchApp({ firstRun: true });
  const { page } = running;
  await page.getByRole("button", { name: "Mods", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mods", level: 1 })).toBeVisible();
  await page.reload();
  await expect(setup(page)).toBeVisible();
});
