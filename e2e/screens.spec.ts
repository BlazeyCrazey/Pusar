// Every screen in the states people actually see, checked for accessibility
// problems and compared against saved screenshots so layout breakage shows up.
// After an intended visual change: npx playwright test e2e/screens.spec.ts --update-snapshots
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, pushInstance, seedAccount, stubIpc, type LaunchOptions, type RunningApp } from "./launch";

const JOB = "11111111-2222-3333-4444-555555555555";

let running: RunningApp;

// Running axe and comparing screenshots takes longer than the usual checks.
test.describe.configure({ timeout: 60_000 });

test.afterEach(async () => {
  await running.cleanup();
});

async function open(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("heading", { name, level: 1 }).waitFor();
}

/** Fails on any WCAG A or AA problem axe can find, listing each one. */
async function expectAccessible(page: Page) {
  // Legacy mode runs inside the app's own page: Electron can't open the extra page axe would use.
  const results = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const problems = results.violations.map(
    (violation) => `${violation.id}: ${violation.help}\n  ${violation.nodes.map((node) => node.target.join(" ")).join("\n  ")}`,
  );
  expect(problems, problems.join("\n")).toEqual([]);
  // A broken setup would pass every page by checking nothing.
  expect(results.passes.length).toBeGreaterThan(15);
}

async function check(page: Page, name: string) {
  // Fonts and art settle before anything is measured.
  await page.evaluate(() => document.fonts.ready);
  await expectAccessible(page);
  await page.screenshot({ path: `test-results/audit-${name}.png` });
  await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01 });
}

const signedIn: LaunchOptions = { accounts: [seedAccount("a1", "player", "Player One")], prefs: { activeAccountId: "a1" } };

test("first-run setup", async () => {
  running = await launchApp({ firstRun: true });
  await running.page.getByRole("heading", { name: "Set up Pusar", level: 1 }).waitFor();
  await check(running.page, "welcome");
});

test("Play, browsing", async () => {
  running = await launchApp();
  await running.page.getByRole("button", { name: /Alpha Game/ }).waitFor();
  await check(running.page, "play-browse");
});

test("Play, with Roblox unreachable", async () => {
  running = await launchApp({ offline: true });
  await running.page.getByText("Can't reach Roblox").waitFor();
  await check(running.page, "play-offline");
});

test("Play, a game ready to launch", async () => {
  running = await launchApp({ ...signedIn, prefs: { ...signedIn.prefs, lastPlaceId: "1001" } });
  await running.page.getByRole("region", { name: "Selected game" }).waitFor();
  await check(running.page, "play-game");
});

test("Play, a game running", async () => {
  running = await launchApp({ ...signedIn, prefs: { ...signedIn.prefs, lastPlaceId: "1001" } });
  await running.page.getByRole("region", { name: "Selected game" }).waitFor();
  await pushInstance(running.app, { status: "running", placeId: "1001" });
  await running.page.getByRole("button", { name: "Kill Instance" }).waitFor();
  await check(running.page, "play-running");
});

test("Play, without Roblox installed", async () => {
  running = await launchApp({ ...signedIn, robloxMissing: true, prefs: { ...signedIn.prefs, lastPlaceId: "1001" } });
  await running.page.getByText("Roblox isn't installed on this PC.").waitFor();
  await check(running.page, "play-no-roblox");
});

test("Library", async () => {
  running = await launchApp({
    ...signedIn,
    library: {
      recent: [
        { universeId: "7", placeId: "70", name: "Saved Game", creatorName: "Maker" },
        { universeId: "8", placeId: "80", name: "Another Game" },
      ],
      favorites: [{ universeId: "7", placeId: "70", name: "Saved Game" }],
    },
  });
  await stubIpc(running.app, "friends:list", {
    ok: true,
    data: {
      signedIn: true,
      friends: [
        { userId: 1, username: "ann", displayName: "Ann", status: "inGame", gameName: "Tower Game", join: { placeId: "1001", jobId: JOB } },
        { userId: 2, username: "cy", displayName: "Cy", status: "online" },
      ],
    },
  });
  await open(running.page, "Library");
  await running.page.getByRole("button", { name: "Join Ann" }).waitFor();
  await check(running.page, "library");
});

test("Mods", async () => {
  running = await launchApp();
  await open(running.page, "Mods");
  await running.page.getByRole("status").waitFor();
  await check(running.page, "mods");
});

test("Mods, without Roblox installed", async () => {
  running = await launchApp({ robloxMissing: true });
  await open(running.page, "Mods");
  await running.page.getByRole("status").waitFor();
  await check(running.page, "mods-no-roblox");
});

test("Accounts, empty", async () => {
  running = await launchApp();
  await open(running.page, "Accounts");
  await check(running.page, "accounts-empty");
});

test("Accounts, signed in", async () => {
  running = await launchApp(signedIn);
  await open(running.page, "Accounts");
  await running.page.getByRole("listitem").getByText("@player", { exact: true }).waitFor();
  await check(running.page, "accounts");
});

test("Settings", async () => {
  running = await launchApp();
  await open(running.page, "Settings");
  await running.page.getByRole("switch", { name: /Show your game on Discord/ }).waitFor();
  await check(running.page, "settings");
});
