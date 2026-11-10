import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FAKE_INSTALL, ipcCalls, launchApp, pushInstance, seedAccount, stubIpc, type RunningApp } from "./launch";

const JOB = "11111111-2222-3333-4444-555555555555";

let running: RunningApp;

test.afterEach(async () => {
  await running.cleanup();
});

const openLibrary = async (page: Page) => {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: "Library", level: 1 }).waitFor();
};

const section = (page: Page, name: string) => page.getByRole("region", { name });
const friends = (page: Page) => page.getByRole("complementary", { name: "Friends online" });

const savedLibrary = (userData: string) =>
  JSON.parse(readFileSync(path.join(userData, "library.json"), "utf8")) as { favorites: Array<{ placeId: string }> };

test.describe("game lists", () => {
  test("explains the empty lists", async () => {
    running = await launchApp();
    const { page, problems } = running;
    await openLibrary(page);
    await expect(section(page, "Favorites")).toContainText("Star a game");
    await expect(section(page, "Recently played")).toContainText("Games you launch");
    expect(problems).toEqual([]);
    await page.screenshot({ path: "test-results/library-empty.png" });
  });

  test("a starred game shows up in Favorites, opens from there, and can be unstarred", async () => {
    running = await launchApp();
    const { page, userData } = running;

    await page.getByRole("button", { name: /Alpha Game/ }).click();
    const hero = page.getByRole("region", { name: "Selected game" });
    await hero.getByRole("button", { name: "Add to favorites" }).click();
    await expect(hero.getByRole("button", { name: "Remove from favorites" })).toBeVisible();
    expect(savedLibrary(userData).favorites.map((game) => game.placeId)).toEqual(["1001"]);

    await page.getByRole("button", { name: "Back" }).click();
    await openLibrary(page);
    await section(page, "Favorites").getByRole("button", { name: /Game 1001/ }).click();
    await expect(page.getByRole("heading", { name: "Play", level: 1 })).toBeAttached();
    await expect(hero.getByRole("heading", { name: "Game 1001" })).toBeVisible();

    await hero.getByRole("button", { name: "Remove from favorites" }).click();
    await expect(hero.getByRole("button", { name: "Add to favorites" })).toBeVisible();
    expect(savedLibrary(userData).favorites).toEqual([]);
  });

  test("shows saved games and ignores a damaged entry", async () => {
    running = await launchApp({
      library: {
        recent: [
          { universeId: "7", placeId: "70", name: "Saved Game" },
          { universeId: "not a number", placeId: "1", name: "Broken" },
        ],
        favorites: [],
      },
    });
    const { page, problems } = running;
    await openLibrary(page);
    await expect(section(page, "Recently played").getByRole("button", { name: /Saved Game/ })).toBeVisible();
    await expect(section(page, "Recently played").getByRole("button", { name: /Broken/ })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("survives a library file that isn't JSON's shape", async () => {
    running = await launchApp({ library: "nonsense" });
    const { page } = running;
    await openLibrary(page);
    await expect(section(page, "Favorites")).toContainText("Star a game");
  });
});

test.describe("friends", () => {
  const FRIENDS = {
    signedIn: true,
    friends: [
      { userId: 1, username: "ann", displayName: "Ann", status: "inGame", gameName: "Tower Game", join: { placeId: "1001", jobId: JOB } },
      { userId: 2, username: "bo", displayName: "Bo", status: "inGame" },
      { userId: 3, username: "cy", displayName: "Cy", status: "online" },
    ],
  };

  test("without an account, offers to add one", async () => {
    running = await launchApp();
    const { page } = running;
    await openLibrary(page);
    await expect(friends(page)).toContainText("Add a Roblox account");
    await friends(page).getByRole("button", { name: "Add account" }).click();
    await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
  });

  test("lists who's online, with Join only where it's possible", async () => {
    running = await launchApp({ accounts: [seedAccount("a1", "player")] });
    const { app, page, problems } = running;
    await stubIpc(app, "friends:list", { ok: true, data: FRIENDS });
    await openLibrary(page);

    await expect(friends(page)).toContainText("In Tower Game");
    await expect(friends(page)).toContainText("In a game");
    await expect(friends(page)).toContainText("Online");
    await expect(friends(page).getByRole("button", { name: /^Join/ })).toHaveCount(1);
    await expect(friends(page).getByRole("button", { name: "Join Ann" })).toBeEnabled();
    expect(problems).toEqual([]);
    await page.screenshot({ path: "test-results/library-friends.png" });
  });

  test("Join launches that exact server", async () => {
    running = await launchApp({ accounts: [seedAccount("a1", "player")] });
    const { app, page } = running;
    await stubIpc(app, "friends:list", { ok: true, data: FRIENDS });
    await stubIpc(app, "install:detect", { ok: true, data: [FAKE_INSTALL] });
    await stubIpc(app, "launch:place", { ok: true, data: { via: "page", signed: true, notes: [] } });
    await openLibrary(page);

    await friends(page).getByRole("button", { name: "Join Ann" }).click();
    await expect(page.getByText("Specific server")).toBeVisible();
    await expect.poll(() => ipcCalls(app, "launch:place")).toEqual([
      { accountId: "a1", rootDir: FAKE_INSTALL.rootDir, target: `https://www.roblox.com/games/start?placeId=1001&gameInstanceId=${JOB}` },
    ]);
  });

  test("Join is off while Roblox is running, since a second launch fails", async () => {
    running = await launchApp({ accounts: [seedAccount("a1", "player")] });
    const { app, page } = running;
    await stubIpc(app, "friends:list", { ok: true, data: FRIENDS });
    await openLibrary(page);
    await friends(page).getByRole("button", { name: "Join Ann" }).waitFor();
    await pushInstance(app, { status: "running", placeId: "5" });
    await expect(friends(page).getByRole("button", { name: "Join Ann" })).toBeDisabled();
  });

  test("says when nobody is online", async () => {
    running = await launchApp({ accounts: [seedAccount("a1", "player")] });
    const { app, page } = running;
    await stubIpc(app, "friends:list", { ok: true, data: { signedIn: true, friends: [] } });
    await openLibrary(page);
    await expect(friends(page)).toContainText("None of your friends are online");
  });

  test("shows the reason when the list can't load", async () => {
    running = await launchApp({ accounts: [seedAccount("a1", "player")] });
    const { app, page } = running;
    await stubIpc(app, "friends:list", { ok: false, error: "Roblox ended this account's session." });
    await openLibrary(page);
    await expect(friends(page)).toContainText("Roblox ended this account's session.");
  });
});

test.describe("settings", () => {
  const openSettings = async (page: Page) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("heading", { name: "Settings", level: 1 }).waitFor();
  };
  const prefs = (userData: string) => {
    const file = path.join(userData, "prefs.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  };

  test("what happens at launch is saved and shown again", async () => {
    running = await launchApp();
    const { page, userData } = running;
    await openSettings(page);
    await page.screenshot({ path: "test-results/settings.png" });
    await page.getByRole("combobox", { name: "When a game starts" }).click();
    await page.getByRole("option", { name: "Hide Pusar in the tray" }).click();
    await expect(page.getByText("comes back by itself")).toBeVisible();
    await expect.poll(() => prefs(userData).onLaunch).toBe("tray");

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await openSettings(page);
    await expect(page.getByRole("combobox", { name: "When a game starts" })).toContainText("Hide Pusar in the tray");
  });

  test("Discord asks for an application ID, and only saves a valid one", async () => {
    running = await launchApp();
    const { page, userData } = running;
    await openSettings(page);
    const id = page.getByRole("textbox", { name: "Discord application ID" });
    await expect(id).toHaveCount(0);

    await page.getByRole("switch", { name: /Show your game on Discord/ }).click();
    await expect.poll(() => prefs(userData).discordEnabled).toBe(true);

    await id.fill("abc");
    await expect(page.getByText("15 to 25 digits")).toBeVisible();
    expect(prefs(userData).discordClientId).toBeUndefined();

    await id.fill("123456789012345678");
    await expect(page.getByText("15 to 25 digits")).toHaveCount(0);
    await expect.poll(() => prefs(userData).discordClientId).toBe("123456789012345678");
  });

  test("server location is off until someone turns it on", async () => {
    running = await launchApp();
    const { page, userData } = running;
    await openSettings(page);
    const location = page.getByRole("switch", { name: /Show where the server is/ });
    await expect(location).not.toBeChecked();
    await expect(page.getByText("ipinfo.io")).toBeVisible();
    await location.click();
    await expect.poll(() => prefs(userData).showServerRegion).toBe(true);
  });

  test("one bad saved value doesn't reset the others", async () => {
    running = await launchApp({ prefs: { onLaunch: "explode", showServerRegion: true } });
    const { page } = running;
    await openSettings(page);
    await expect(page.getByRole("combobox", { name: "When a game starts" })).toContainText("Keep Pusar open");
    await expect(page.getByRole("switch", { name: /Show where the server is/ })).toBeChecked();
  });

  test("the UI can't use this channel to change anything else", async () => {
    running = await launchApp();
    const { page, userData } = running;
    const reply = await page.evaluate(() =>
      (window as unknown as { pusar: { invoke: (c: string, i: unknown) => Promise<unknown> } }).pusar.invoke("prefs:set", {
        activeAccountId: "someone-else",
      }),
    );
    expect(reply).toMatchObject({ ok: false });
    expect(prefs(userData).activeAccountId).toBeUndefined();
  });
});

test.describe("after a launch", () => {
  const windowVisible = (r: RunningApp) => r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible());
  const afterLaunch = (r: RunningApp, behavior: string) =>
    r.app.evaluate((_modules, value) => {
      (globalThis as unknown as { __pusarTest: { applyLaunchBehavior: (b: string) => void } }).__pusarTest.applyLaunchBehavior(value);
    }, behavior);
  const gameEnded = (r: RunningApp) =>
    r.app.evaluate(() => {
      (globalThis as unknown as { __pusarTest: { restoreFromTray: () => void } }).__pusarTest.restoreFromTray();
    });

  test("the tray icon is an image Electron can load", async () => {
    running = await launchApp();
    const empty = await running.app.evaluate(({ app, nativeImage }) =>
      nativeImage.createFromPath(`${app.getAppPath()}/resources/tray.png`).isEmpty(),
    );
    expect(empty).toBe(false);
  });

  test("the tray setting hides the window until the game ends", async () => {
    running = await launchApp();
    await afterLaunch(running, "tray");
    await expect.poll(() => windowVisible(running)).toBe(false);
    await gameEnded(running);
    await expect.poll(() => windowVisible(running)).toBe(true);
    await expect(running.page.getByRole("heading", { name: "Play", level: 1 })).toBeAttached();
  });

  test("keeping Pusar open leaves the window alone", async () => {
    running = await launchApp();
    await afterLaunch(running, "stay");
    expect(await windowVisible(running)).toBe(true);
    await gameEnded(running);
    expect(await windowVisible(running)).toBe(true);
  });

  test("closing the window ends the app and says so in the log", async () => {
    running = await launchApp();
    const child = running.app.process();
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await exited;
    expect(output).toContain("Pusar closed");
  });
});
