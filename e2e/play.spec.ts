import { expect, test, type Page } from "@playwright/test";
import { FAKE_INSTALL, ipcCalls, launchApp, pushInstance, seedAccount, setRobloxOnline, stubIpc, type RunningApp } from "./launch";

const SEARCH = "Search games, or paste a link or place ID";

/** Back to the browsing view, whatever the previous test left open. */
async function browse(page: Page) {
  const back = page.getByRole("button", { name: "Back" });
  if (await back.isVisible()) await back.click();
  await page.getByLabel(SEARCH).fill("");
  await page.getByRole("heading", { name: "Top playing now" }).waitFor();
}

test.describe("Play screen", () => {
  let running: RunningApp;

  test.beforeAll(async () => {
    running = await launchApp({ accounts: [seedAccount("a1", "player_one", "Player One")], prefs: { activeAccountId: "a1" } });
    await stubIpc(running.app, "install:detect", { ok: true, data: [FAKE_INSTALL] });
    await running.page.reload();
    await running.page.locator("nav[aria-label=Main]").waitFor();
  });

  test.afterAll(async () => {
    await running.cleanup();
  });

  test("lists the top games", async () => {
    await expect(running.page.getByRole("button", { name: /Alpha Game/ })).toBeVisible();
    await expect(running.page.getByRole("button", { name: /Beta Game/ })).toContainText("1.2K playing");
  });

  test("picking a game opens its own view with details and Launch", async () => {
    const { page } = running;
    await page.getByRole("button", { name: /Alpha Game/ }).click();
    const hero = page.getByRole("region", { name: "Selected game" });
    await expect(hero.getByRole("heading", { name: "Game 1001" })).toBeVisible();
    await expect(hero).toContainText("by Test Maker");
    await expect(hero).toContainText("4.3K playing");
    await expect(hero.getByRole("combobox", { name: "Account" })).toContainText("Player One (@player_one)");
    await expect(hero.getByRole("button", { name: "Launch" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Top playing now" })).toBeHidden();
    await expect(page.getByLabel(SEARCH)).toBeHidden();
  });

  test("Launch sends the active account, the game and the current install", async () => {
    const { app, page } = running;
    await stubIpc(app, "launch:place", { ok: true, data: { via: "page", signed: true, notes: [] } });
    await page.getByRole("button", { name: "Launch" }).click();
    await expect(page.getByText("Roblox is starting").first()).toBeVisible();
    expect(await ipcCalls(app, "launch:place")).toEqual([
      { accountId: "a1", rootDir: FAKE_INSTALL.rootDir, target: "1001" },
    ]);
  });

  test("a failed launch explains why and re-enables the button", async () => {
    const { app, page } = running;
    await stubIpc(app, "launch:place", { ok: false, error: "Roblox ended this account's session." });
    await page.getByRole("button", { name: "Launch" }).click();
    await expect(page.getByText("Roblox ended this account's session.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch" })).toBeEnabled();
  });

  test("Back returns to browsing", async () => {
    const { page } = running;
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("region", { name: "Selected game" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Top playing now" })).toBeVisible();
  });

  test("Back from a search result returns to those results", async () => {
    const { page } = running;
    await page.getByLabel(SEARCH).fill("tower");
    await page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Tower Game/ }).click();
    await expect(page.getByRole("region", { name: "Selected game" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel(SEARCH)).toHaveValue("tower");
    await expect(page.getByRole("button", { name: /Tower Game/ })).toBeVisible();
  });

  test("search hides sponsored games", async () => {
    const { page } = running;
    await browse(page);
    await page.getByLabel(SEARCH).fill("tower");
    const results = page.getByRole("region", { name: "Search results" });
    await expect(results.getByRole("button", { name: /Tower Game/ })).toBeVisible();
    await expect(results.getByRole("button", { name: /Sponsored Game/ })).toHaveCount(0);
  });

  test("a search with no matches says so", async () => {
    const { page } = running;
    await page.getByLabel(SEARCH).fill("zzzz");
    await expect(page.getByText('No games found for "zzzz".')).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByRole("heading", { name: "Top playing now" })).toBeVisible();
  });

  test("a rate-limited search says so instead of blaming the connection", async () => {
    const { page } = running;
    await browse(page);
    await page.getByLabel(SEARCH).fill("limited");
    await expect(page.getByText("Roblox is limiting requests right now.")).toBeVisible();
    await expect(page.getByText("Couldn't reach Roblox")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear search" }).click();
  });

  test("a place ID opens on Enter and doesn't linger in the box", async () => {
    const { page } = running;
    await page.getByLabel(SEARCH).fill("189707");
    await expect(page.getByText("Press Enter to open this game.")).toBeVisible();
    await page.getByLabel(SEARCH).press("Enter");
    await expect(page.getByRole("region", { name: "Selected game" }).getByRole("heading", { name: "Game 189707" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel(SEARCH)).toHaveValue("");
  });

  test("a server link launches that specific server", async () => {
    const { app, page } = running;
    await browse(page);
    const job = "0b5c2a8e-1f3d-4c6a-9e7b-2d4f6a8c0e1b";
    await page.getByLabel(SEARCH).fill(`https://www.roblox.com/games/start?placeId=2222&gameInstanceId=${job}`);
    await page.getByLabel(SEARCH).press("Enter");
    const hero = page.getByRole("region", { name: "Selected game" });
    await expect(hero).toContainText("Specific server");
    await stubIpc(app, "launch:place", { ok: true, data: { via: "page", signed: true, notes: [] } });
    await hero.getByRole("button", { name: "Launch" }).click();
    await expect.poll(() => ipcCalls(app, "launch:place")).toEqual([
      {
        accountId: "a1",
        rootDir: FAKE_INSTALL.rootDir,
        target: `https://www.roblox.com/games/start?placeId=2222&gameInstanceId=${job}`,
      },
    ]);
  });

  test("a private server link is explained instead of joining a public server", async () => {
    const { page } = running;
    await browse(page);
    await page.getByLabel(SEARCH).fill("https://www.roblox.com/games/1818/Name?privateServerLinkCode=123");
    await page.getByLabel(SEARCH).press("Enter");
    await expect(page.getByText("Private server links aren't supported yet.").first()).toBeVisible();
  });

  test("an unknown game is explained", async () => {
    const { page } = running;
    await browse(page);
    await page.getByLabel(SEARCH).fill("404404");
    await page.getByLabel(SEARCH).press("Enter");
    await expect(page.getByText("Roblox couldn't find that game.").first()).toBeVisible();
  });

  test.describe("while Roblox is running", () => {
    test.beforeAll(async () => {
      const { page } = running;
      await browse(page);
      await page.getByRole("button", { name: /Alpha Game/ }).click();
      await page.getByRole("region", { name: "Selected game" }).getByRole("heading", { name: "Game 1001" }).waitFor();
    });

    test("Kill Instance replaces Launch as soon as the game starts", async () => {
      const { app, page } = running;
      await pushInstance(app, { status: "starting", placeId: "1001" });
      await expect(page.getByRole("button", { name: "Kill Instance" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Launch" })).toHaveCount(0);
      await expect(page.getByText("Roblox is starting.")).toBeVisible();

      await pushInstance(app, { status: "running", placeId: "1001" });
      await expect(page.getByText("This game is running.")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toContainText("In game");
    });

    test("another game can't be launched either", async () => {
      const { app, page } = running;
      await pushInstance(app, { status: "running", placeId: "9999" });
      await expect(page.getByText("Another game is running. Kill it to launch this one.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Launch" })).toHaveCount(0);
    });

    test("Kill Instance warns first, and Cancel leaves Roblox running", async () => {
      const { app, page } = running;
      await stubIpc(app, "instance:kill", { ok: true, data: { status: "idle" } });
      await page.getByRole("button", { name: "Kill Instance" }).click();
      const dialog = page.getByRole("dialog", { name: "Kill this Roblox instance?" });
      await expect(dialog).toContainText("anything unsaved in your game will be lost");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      expect(await ipcCalls(app, "instance:kill")).toEqual([]);
      await expect(page.getByRole("button", { name: "Kill Instance" })).toBeVisible();
    });

    test("confirming kills Roblox and brings Launch back", async () => {
      const { app, page } = running;
      await stubIpc(app, "instance:kill", { ok: true, data: { status: "idle" } });
      await page.getByRole("button", { name: "Kill Instance" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Kill Instance" }).click();
      await expect(page.getByRole("button", { name: "Launch" })).toBeVisible();
      await expect(page.getByText("Roblox closed").first()).toBeVisible();
      expect(await ipcCalls(app, "instance:kill")).toHaveLength(1);
    });

    test("a failed kill explains why and stays available", async () => {
      const { app, page } = running;
      await pushInstance(app, { status: "running", placeId: "1001" });
      await stubIpc(app, "instance:kill", { ok: false, error: "Access is denied." });
      await page.getByRole("button", { name: "Kill Instance" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Kill Instance" }).click();
      await expect(page.getByText("Access is denied.").first()).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("button", { name: "Kill Instance" })).toBeVisible();
      await pushInstance(app, { status: "idle" });
      await expect(page.getByRole("button", { name: "Launch" })).toBeVisible();
    });
  });

  test("produced no console errors or CSP violations", () => {
    expect(running.problems).toEqual([]);
  });
});

test.describe("when Roblox can't be reached", () => {
  const OFFLINE_NOTE = "Can't reach Roblox right now. Pusar will keep trying.";
  const account = seedAccount("a1", "player_one");

  test("says so, then recovers by itself once Roblox is back", async () => {
    const running = await launchApp({ accounts: [account], prefs: { lastPlaceId: "777777" }, offline: true });
    const { app, page } = running;
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
    await expect(page.getByText("couldn't find")).toHaveCount(0);

    await setRobloxOnline(app, true);
    await expect(page.getByRole("heading", { name: "Game 777777" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: /Alpha Game/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OFFLINE_NOTE)).toHaveCount(0);
    await running.cleanup();
  });

  test("a pasted link blames the connection, not the game", async () => {
    const running = await launchApp({ accounts: [account], offline: true });
    const { page } = running;
    await page.getByLabel(SEARCH).fill("189707");
    await page.getByLabel(SEARCH).press("Enter");
    await expect(page.getByText("Couldn't reach Roblox. Check your connection and try again.").first()).toBeVisible();
    await expect(page.getByText("Roblox couldn't find that game.")).toHaveCount(0);
    await running.cleanup();
  });

  test("the last game doesn't pop up over someone who started searching", async () => {
    const running = await launchApp({ accounts: [account], prefs: { lastPlaceId: "777777" }, offline: true });
    const { app, page } = running;
    await page.getByLabel(SEARCH).fill("tower");
    await setRobloxOnline(app, true);
    await page.waitForTimeout(6000);
    await expect(page.getByRole("region", { name: "Selected game" })).toBeHidden();
    await expect(page.getByLabel(SEARCH)).toHaveValue("tower");
    await running.cleanup();
  });
});

test.describe("Play screen with saved state", () => {
  test("reopens the last game played", async () => {
    const running = await launchApp({ accounts: [seedAccount("a1", "player_one")], prefs: { lastPlaceId: "777777" } });
    await expect(running.page.getByRole("heading", { name: "Game 777777" })).toBeVisible();
    await running.cleanup();
  });

  test("with no account, points to Accounts", async () => {
    const running = await launchApp({ prefs: { lastPlaceId: "777777" } });
    const { page } = running;
    await expect(page.getByText("Add your Roblox account to launch this game.")).toBeVisible();
    await page.getByRole("region", { name: "Selected game" }).getByRole("button", { name: "Add account" }).click();
    await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
    await running.cleanup();
  });

  test("with Roblox missing, Launch is disabled and says why", async () => {
    const running = await launchApp({ accounts: [seedAccount("a1", "player_one")], prefs: { lastPlaceId: "777777" } });
    const { app, page } = running;
    await stubIpc(app, "install:detect", { ok: true, data: [] });
    await page.reload();
    await expect(page.getByText("Roblox isn't installed on this PC.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch" })).toBeDisabled();
    await expect(page.getByRole("contentinfo")).toContainText("Roblox not installed");
    await running.cleanup();
  });
});
