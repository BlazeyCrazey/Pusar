import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RunningApp {
  app: ElectronApplication;
  page: Page;
  /** Console errors and uncaught exceptions, including CSP violations. */
  problems: string[];
  fakeRoblox: FakeRoblox;
  /** The throwaway profile folder. */
  userData: string;
  cleanup: () => Promise<void>;
}

export interface FakeRoblox {
  flagsFile: string;
  familyFile: string;
  cursorFile: string;
}

export const ORIGINAL_FAMILY = JSON.stringify({ name: "Builder Sans", faces: [{ assetId: "rbxasset://fonts/Builder.otf" }] }, null, "\t");
export const ORIGINAL_CURSOR = "original-cursor";

/** A folder laid out like a Roblox install. Pusar really changes these files during tests. */
function createFakeRoblox(root: string): FakeRoblox {
  const version = path.join(root, "Roblox", "Versions", "version-e2e0000000000000");
  const families = path.join(version, "content", "fonts", "families");
  const cursors = path.join(version, "content", "textures", "Cursors");
  mkdirSync(families, { recursive: true });
  mkdirSync(cursors, { recursive: true });
  writeFileSync(path.join(version, "RobloxPlayerBeta.exe"), "");
  const familyFile = path.join(families, "BuilderSans.json");
  const cursorFile = path.join(cursors, "ArrowCursor.png");
  writeFileSync(familyFile, ORIGINAL_FAMILY);
  writeFileSync(cursorFile, ORIGINAL_CURSOR);
  return { flagsFile: path.join(version, "ClientSettings", "ClientAppSettings.json"), familyFile, cursorFile };
}

function emptyFakeRoblox(root: string): FakeRoblox {
  mkdirSync(root, { recursive: true });
  return { flagsFile: "", familyFile: "", cursorFile: "" };
}

export interface SeedAccount {
  id: string;
  partition: string;
  userId: number;
  username: string;
  displayName: string;
  addedAt: string;
}

export function seedAccount(id: string, username: string, displayName = username): SeedAccount {
  return { id, partition: `persist:acct-${id}`, userId: 1000, username, displayName, addedAt: "2026-01-01T00:00:00Z" };
}

export interface LaunchOptions {
  args?: string[];
  ready?: string;
  /** Written to the throwaway profile before the app starts. */
  accounts?: SeedAccount[];
  prefs?: Record<string, unknown>;
  /** Written as the saved favorites and recents. */
  library?: unknown;
  /** Start with Roblox unreachable. */
  offline?: boolean;
  /** Show first-run setup, as a brand new user would see it. Off by default so tests start on Play. */
  firstRun?: boolean;
  /** Leave the fake Roblox folder empty, as on a PC without Roblox. */
  robloxMissing?: boolean;
}

export async function setRobloxOnline(app: ElectronApplication, online: boolean): Promise<void> {
  await app.evaluate((_modules, offline) => {
    (globalThis as unknown as { __robloxOffline?: boolean }).__robloxOffline = offline;
  }, !online);
}

/** Replaces the public Roblox APIs inside the main process, so tests need no network. */
async function stubRobloxApis(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const listing = (universeId: number, rootPlaceId: number, name: string) => ({
      universeId,
      rootPlaceId,
      name,
      creatorName: "Test Maker",
      playerCount: 1234,
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if ((globalThis as unknown as { __robloxOffline?: boolean }).__robloxOffline) throw new TypeError("fetch failed");
      const url = new URL(String(input));
      if (url.pathname.includes("/explore-api/")) {
        return json({ sorts: [{ sortId: "top-playing-now", games: [listing(1, 1001, "Alpha Game"), listing(2, 1002, "Beta Game")] }] });
      }
      if (url.pathname.includes("/search-api/")) {
        if (url.searchParams.get("searchQuery") === "limited") {
          return new Response("", { status: 429, headers: { "retry-after": "0" } });
        }
        const empty = url.searchParams.get("searchQuery") === "zzzz";
        return json({
          searchResults: empty
            ? []
            : [
                { contentGroupType: "Game", contents: [listing(3, 1003, "Tower Game")] },
                { contentGroupType: "Game", contents: [{ ...listing(4, 1004, "Sponsored Game"), isSponsored: true }] },
              ],
        });
      }
      const place = /\/places\/(\d+)\/universe/.exec(url.pathname);
      if (place) return json(place[1] === "404404" ? {} : { universeId: Number(place[1]) });
      if (url.hostname === "games.roblox.com") {
        return json({ data: [{ name: `Game ${url.searchParams.get("universeIds")}`, description: "A test game.", creator: { name: "Test Maker" }, playing: 4321 }] });
      }
      if (url.hostname === "thumbnails.roblox.com") return json({ data: [] });
      return json({}, 404);
    }) as typeof fetch;
  });
}

/** Starts the built app with a throwaway profile, so tests never touch real accounts. */
export async function launchApp(options: LaunchOptions = {}): Promise<RunningApp> {
  const userData = mkdtempSync(path.join(os.tmpdir(), "pusar-e2e-"));
  if (options.accounts) writeFileSync(path.join(userData, "accounts.json"), JSON.stringify(options.accounts));
  const prefs = { ...(options.firstRun ? {} : { onboarded: true }), ...options.prefs };
  writeFileSync(path.join(userData, "prefs.json"), JSON.stringify(prefs));
  if (options.library) writeFileSync(path.join(userData, "library.json"), JSON.stringify(options.library));

  const fakeRoot = path.join(userData, "fake-roblox");
  const fakeRoblox = options.robloxMissing ? emptyFakeRoblox(fakeRoot) : createFakeRoblox(fakeRoot);
  const app = await electron.launch({
    // Fixed scaling, so saved screenshots match on any display, CI included.
    args: [".", `--user-data-dir=${userData}`, `--fake-roblox-dir=${fakeRoot}`, "--force-device-scale-factor=1", ...(options.args ?? [])],
  });
  const page = await app.firstWindow();
  const ready = options.ready ?? "nav[aria-label=Main]";
  await page.locator(ready).waitFor();

  // Calls made before the stub existed are discarded by reloading.
  await stubRobloxApis(app);
  if (options.offline) await setRobloxOnline(app, false);
  await page.reload();
  await page.locator(ready).waitFor();

  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  return {
    app,
    page,
    problems,
    fakeRoblox,
    userData,
    cleanup: async () => {
      await app.close().catch(() => {});
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

type IpcResponse = { ok: true; data: unknown } | { ok: false; error: string };

/** Replaces one IPC handler, for actions tests must not really perform. */
export async function stubIpc(app: ElectronApplication, channel: string, response: IpcResponse): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, stub) => {
      const store = globalThis as unknown as { __ipcCalls?: Record<string, unknown[]> };
      store.__ipcCalls ??= {};
      const calls: unknown[] = [];
      store.__ipcCalls[stub.channel] = calls;
      ipcMain.removeHandler(stub.channel);
      ipcMain.handle(stub.channel, (_event, input: unknown) => {
        calls.push(input);
        return stub.response;
      });
    },
    { channel, response },
  );
}

export function ipcCalls(app: ElectronApplication, channel: string): Promise<unknown[]> {
  return app.evaluate(
    (_modules, name) => (globalThis as unknown as { __ipcCalls: Record<string, unknown[]> }).__ipcCalls[name] ?? [],
    channel,
  );
}

/** Makes the next file picker return this file, as if the user had chosen it. */
export async function stubFilePicker(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog;
  }, file);
}

/** Tells the UI whether Roblox is running, as the real monitor would. */
export async function pushInstance(app: ElectronApplication, state: { status: string; placeId?: string }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, next) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send("instance", next);
  }, state);
}

export const FAKE_INSTALL = {
  platform: "win32",
  source: "Roblox",
  versionId: "version-abcdef1234567890",
  playerPath: "C:\\Fake\\RobloxPlayerBeta.exe",
  rootDir: "C:\\Fake\\version-abcdef1234567890",
  contentDir: "C:\\Fake\\content",
  clientSettingsFile: "C:\\Fake\\ClientSettings\\ClientAppSettings.json",
  logsDir: "C:\\Fake\\logs",
  isProtocolHandler: true,
  hasFontFamilies: true,
  modifiedAt: 1,
};
