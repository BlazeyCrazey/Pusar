import { expect, test } from "@playwright/test";
import { ipcCalls, launchApp, seedAccount, stubIpc, type RunningApp } from "./launch";

const ONE = seedAccount("a1", "player_one", "Player One");
const TWO = seedAccount("a2", "player_two", "Player Two");

async function openAccounts(running: RunningApp) {
  await running.page.getByRole("button", { name: "Accounts", exact: true }).click();
  await running.page.getByRole("heading", { name: "Accounts", level: 1 }).waitFor();
}

test.describe("Accounts screen", () => {
  let running: RunningApp;

  test.beforeAll(async () => {
    running = await launchApp({ accounts: [ONE, TWO], prefs: { activeAccountId: "a1" } });
    await openAccounts(running);
  });

  test.afterAll(async () => {
    await running.cleanup();
  });

  test("lists accounts and marks the active one", async () => {
    const { page } = running;
    const rows = page.getByRole("listitem");
    await expect(rows.filter({ hasText: "Player One" })).toContainText("Active");
    await expect(rows.filter({ hasText: "Player Two" })).toContainText("Use this account");
    await expect(page.getByRole("contentinfo")).toContainText("@player_one");
  });

  test("tells people what to do if the human check gets stuck", async () => {
    await expect(running.page.getByText("Email a code")).toBeVisible();
  });

  test("switching accounts updates everywhere and survives a reload", async () => {
    const { page } = running;
    await page.getByRole("button", { name: "Use this account" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Player Two" })).toContainText("Active");
    await expect(page.getByRole("contentinfo")).toContainText("@player_two");

    await page.reload();
    await expect(page.getByRole("contentinfo")).toContainText("@player_two");
    await openAccounts(running);
  });

  test("cancelling removal keeps the account", async () => {
    const { app, page } = running;
    await stubIpc(app, "accounts:remove", { ok: true, data: [ONE] });
    await page.getByRole("button", { name: "Remove Player One" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove Player One?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await ipcCalls(app, "accounts:remove")).toEqual([]);
  });

  test("removal asks first, then removes that account", async () => {
    const { app, page } = running;
    await stubIpc(app, "accounts:remove", { ok: true, data: [ONE] });
    await page.getByRole("button", { name: "Remove Player Two" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove Player Two?" });
    await expect(dialog).toContainText("signed out of Roblox");
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Removed Player Two").first()).toBeVisible();
    expect(await ipcCalls(app, "accounts:remove")).toEqual([{ id: "a2" }]);
  });

  test("adding an account confirms who signed in", async () => {
    const { app, page } = running;
    await stubIpc(app, "accounts:add", { ok: true, data: { account: seedAccount("a3", "new_player", "New Player") } });
    await page.getByRole("button", { name: "Add account" }).click();
    await expect(page.getByText("Signed in as New Player").first()).toBeVisible();
  });

  test("a sign-in failure shows the reason", async () => {
    const { app, page } = running;
    await stubIpc(app, "accounts:add", { ok: false, error: "Your network is blocking roblox.com." });
    await page.getByRole("button", { name: "Add account" }).click();
    await expect(page.getByText("Your network is blocking roblox.com.").first()).toBeVisible();
  });
});

test("closing the sign-in window isn't treated as an error", async () => {
  const running = await launchApp();
  const { app, page } = running;
  await openAccounts(running);
  await stubIpc(app, "accounts:add", { ok: true, data: { account: null } });
  await page.getByRole("button", { name: "Add account" }).click();
  await expect.poll(() => ipcCalls(app, "accounts:add")).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Add account" })).toBeEnabled();
  await expect(page.getByText("Couldn't add that account")).toHaveCount(0);
  await running.cleanup();
});

test("with no accounts, explains what to do", async () => {
  const running = await launchApp();
  await openAccounts(running);
  await expect(running.page.getByText("Add your Roblox account to launch games from Pusar.")).toBeVisible();
  await running.cleanup();
});

test("Settings keeps the link option off when running from source", async () => {
  const running = await launchApp();
  const { page } = running;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("switch", { name: /Open Roblox links with Pusar/ })).toBeDisabled();
  await expect(page.getByText("Only available in the installed app.")).toBeVisible();
  await running.cleanup();
});
