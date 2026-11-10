// Implements every IPC channel in shared/ipc.ts.
import { app, dialog, ipcMain } from "electron";
import path from "node:path";
import { BackupStore } from "../../core/backup";
import { applyFlags, FLAG_PRESETS, flagStatus, readFlags } from "../../core/fflags";
import { applyCustomFont } from "../../core/fonts";
import type { RobloxInstall } from "../../core/install";
import { parsePlaceTarget, unsupportedLinkReason } from "../../core/launchUri";
import { redact } from "../../core/redact";
import { getGameDetails, getPopularGames } from "../../core/robloxApi";
import { IPC_CHANNELS, type IpcChannel, type IpcInput, type IpcOutput, type IpcResult } from "../../shared/ipc";
import { ROBLOX_BUSY, ROBLOX_UNREACHABLE } from "../../shared/messages";
import { accountOverview, addAccount, clientFor, getAccount, listAccounts, removeAccount } from "../accounts";
import { ActivityService } from "../activity";
import { friendsOfActiveAccount } from "../friends";
import { InstanceMonitor } from "../instanceMonitor";
import { launchPlace, openRobloxApp } from "../launcher";
import { libraryView, rememberLaunch, setGameFavorite } from "../library";
import { linkHandlerStatus, setLinkHandler } from "../linkHandler";
import { errorMessage, log, logHistory } from "../logger";
import { mods, setModsApplyCheck } from "../mods";
import { currentPlatform } from "../platform";
import { readPrefs, updatePrefs } from "../prefs";
import { ensureRobloxReachable } from "../robloxWeb";
import { searchRoblox } from "../search";
import { isTrustedSender } from "../security";
import { applyLaunchBehavior, restoreFromTray } from "../tray";
import { getMainWindow } from "../windows";
import { inputSchemas } from "./schemas";

type Handlers = { [C in IpcChannel]: (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>> };

/** Turns what the user typed into a place to launch, or explains why it can't be. */
function parseTarget(input: string) {
  const reason = unsupportedLinkReason(input);
  if (reason) throw new Error(reason);
  const target = parsePlaceTarget(input);
  if (!target) throw new Error("Enter a place ID or a roblox.com game link");
  return target;
}

const MODS_STARTUP_DELAY_MS = 2000;

async function pickFile(title: string, filters: Electron.FileFilter[]): Promise<string | null> {
  const window = getMainWindow();
  if (!window) return null;
  const pick = await dialog.showOpenDialog(window, { title, filters, properties: ["openFile"] });
  return pick.canceled ? null : (pick.filePaths[0] ?? null);
}

const backupsRoot = () => path.join(app.getPath("userData"), "backups");
const backupFor = (install: RobloxInstall) => BackupStore.forInstall(backupsRoot(), install.rootDir);

async function findInstall(rootDir: string): Promise<RobloxInstall> {
  const found = (await currentPlatform().detectInstalls()).find((install) => install.rootDir === rootDir);
  if (!found) throw new Error("That Roblox install is gone (Roblox may have updated). Detect it again.");
  return found;
}

// Results for the M0 spike panel's "Copy spike report" button.
const report: Record<string, unknown> = {};
function record(key: string, value: unknown): void {
  report[key] = { at: new Date().toISOString(), value };
}

export function registerIpc(): void {
  const activity = new ActivityService((update) => {
    getMainWindow()?.webContents.send("activity", update);
    if (update.state.status === "inGame") {
      record("activity.inGame", {
        game: update.game?.name ?? null,
        serverType: update.state.serverType,
        presence: update.presence,
      });
    }
  });

  const applyActivitySettings = () => {
    const { discordEnabled, discordClientId, showServerRegion } = readPrefs();
    return activity.configure({
      discordClientId: discordEnabled && discordClientId ? discordClientId : undefined,
      showRegion: showServerRegion === true,
    });
  };
  // Set before the monitor starts, so a game that's already running is shown correctly.
  applyActivitySettings().catch((err: unknown) => log(`Activity: ${errorMessage(err)}`));

  const instances = new InstanceMonitor(
    (state) => {
      getMainWindow()?.webContents.send("instance", state);
      if (state.status === "idle") {
        activity.gameEnded();
        restoreFromTray();
      }
    },
    (event) => activity.feed(event),
  );
  setModsApplyCheck(() => instances.state.status === "idle");
  instances
    .start()
    // Waits so a game that's already running is noticed before any files change.
    .then(() => setTimeout(() => void mods().syncOnStartup(), MODS_STARTUP_DELAY_MS).unref())
    .catch((err: unknown) => log(`Instance monitor: ${errorMessage(err)}`));

  const handlers: Handlers = {
    "install:detect": async () => {
      const installs = await currentPlatform().detectInstalls();
      record(
        "installs",
        installs.map((i) => ({
          source: i.source,
          versionId: i.versionId,
          isProtocolHandler: i.isProtocolHandler,
          hasFontFamilies: i.hasFontFamilies,
        })),
      );
      log(`Detected ${installs.length} Roblox install(s)`);
      return installs;
    },

    "mods:status": async ({ rootDir }) => {
      const install = await findInstall(rootDir);
      const flags = await readFlags(install.clientSettingsFile);
      return {
        flags: Object.entries(flags).map(([name, value]) => ({ name, value, status: flagStatus(name) })),
        changedFiles: (await backupFor(install).entries()).length,
      };
    },

    "mods:applyFlags": async ({ rootDir, preset }) => {
      const install = await findInstall(rootDir);
      const chosen = FLAG_PRESETS[preset];
      if (!chosen) throw new Error("Unknown preset");
      const written = await applyFlags(install.clientSettingsFile, chosen.flags, backupFor(install));
      log(`FFlags: wrote ${Object.keys(chosen.flags).length} flag(s) to ${install.clientSettingsFile}`);
      record("mods.flags", { file: install.clientSettingsFile, written });
      return written;
    },

    "mods:applyFont": async ({ rootDir }) => {
      const install = await findInstall(rootDir);
      const window = getMainWindow();
      if (!window) return null;
      const pick = await dialog.showOpenDialog(window, {
        title: "Choose a font for Roblox's UI",
        defaultPath: process.platform === "win32" ? "C:\\Windows\\Fonts" : "/System/Library/Fonts/Supplemental",
        filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
        properties: ["openFile"],
      });
      const fontFile = pick.filePaths[0];
      if (pick.canceled || !fontFile) return null;
      const result = await applyCustomFont(install.contentDir, fontFile, backupFor(install));
      log(`Font: applied ${path.basename(fontFile)} to ${result.familiesUpdated.length} families`);
      record("mods.font", {
        font: path.basename(fontFile),
        familiesUpdated: result.familiesUpdated.length,
        familiesSkipped: result.familiesSkipped,
      });
      return result;
    },

    "mods:revert": async ({ rootDir }) => {
      const install = await findInstall(rootDir);
      const result = await backupFor(install).restoreAll();
      log(`Revert: restored ${result.restored} file(s), removed ${result.removed} added file(s)`);
      record("mods.revert", result);
      return result;
    },

    "mods:overview": () => mods().overview(),
    "mods:setEnabled": ({ enabled }) => mods().setEnabled(enabled),
    "mods:addFlag": ({ name }) => mods().addFlag(name),
    "mods:setFlag": ({ name, value }) => mods().setFlag(name, value),
    "mods:removeFlag": ({ name }) => mods().removeFlag(name),
    "mods:setPreset": ({ id, active }) => mods().setPreset(id, active),

    "mods:chooseFont": async () => {
      const file = await pickFile("Choose a font for Roblox", [{ name: "Fonts", extensions: ["ttf", "otf"] }]);
      return file ? mods().chooseFont(file) : null;
    },

    "mods:clearFont": () => mods().clearFont(),

    "mods:importPack": async () => {
      const file = await pickFile("Choose a .zip, or the manifest.json in a mod pack folder", [
        { name: "Mod packs", extensions: ["zip", "json"] },
      ]);
      return file ? mods().importPack(file) : null;
    },

    "mods:setPackEnabled": ({ id, enabled }) => mods().setPackEnabled(id, enabled),
    "mods:removePack": ({ id }) => mods().removePack(id),

    "accounts:list": () => listAccounts(),

    "accounts:overview": () => accountOverview(),

    "accounts:setActive": ({ id }) => {
      updatePrefs({ activeAccountId: getAccount(id).id });
      return accountOverview();
    },

    "accounts:add": async () => {
      const result = await addAccount(getMainWindow() ?? undefined);
      if (result.account) {
        record("login", { duplicate: !!result.duplicate, hba: result.diagnosis ?? null });
        // Someone adding an account almost always means to use it next.
        updatePrefs({ activeAccountId: result.account.id });
      }
      return result;
    },

    "accounts:remove": async ({ id }) => {
      await removeAccount(id);
      return listAccounts();
    },

    "accounts:diagnose": async ({ id }) => {
      await ensureRobloxReachable();
      const account = getAccount(id);
      const client = clientFor(account.partition);
      const hasCookie = await client.hasSessionCookie();
      const hba = await client.diagnose();
      const me = await client.request({ method: "GET", url: "https://users.roblox.com/v1/users/authenticated" });
      const result = { hasCookie, profileRequest: { status: me.status, signed: me.signed }, hba };
      record("diagnose", result);
      log(`Diagnose ${account.username}: session=${hasCookie}, profile HTTP ${me.status}, signed=${me.signed}, keyPair=${hba.hasKeyPair}`);
      log(
        `Diagnose signing rules: secureAuthIntent=${hba.secureAuthIntentEnabled}, allUrls=${hba.batEnabledForAllUrls}, ` +
          `signed sites=[${(hba.whitelistSites ?? []).join(", ")}], exempt=[${(hba.exemptSites ?? []).join(", ")}]`,
      );
      return result;
    },

    "games:search": ({ query }) => searchRoblox(query),

    "games:popular": async () => {
      const games = await getPopularGames();
      if (!games) throw new Error(ROBLOX_UNREACHABLE);
      return games;
    },

    "games:resolve": async ({ input }) => {
      const target = parseTarget(input);
      const game = await getGameDetails(target.placeId);
      if (!game) throw new Error("Roblox couldn't find that game.");
      return { target, game };
    },

    "prefs:get": () => readPrefs(),

    "prefs:set": async (changes) => {
      const prefs = updatePrefs(changes);
      await applyActivitySettings();
      return prefs;
    },

    "library:get": () => libraryView(),

    "library:setFavorite": ({ game, favorite }) => setGameFavorite(game, favorite),

    "friends:list": () => friendsOfActiveAccount(),

    "linkHandler:status": () => linkHandlerStatus(),

    "linkHandler:set": ({ enabled }) => setLinkHandler(enabled),

    "instance:state": () => instances.state,

    "instance:kill": () => instances.kill(),

    "launch:place": async ({ accountId, rootDir, target }) => {
      // A second launch makes Roblox fail with "Authentication Failed: 429".
      if (instances.state.status !== "idle") throw new Error("Roblox is already running. Kill that instance first.");
      const parsed = parseTarget(target);
      const account = getAccount(accountId);
      const install = await findInstall(rootDir);
      await ensureRobloxReachable();
      const warning = await mods().prepareLaunch(install);
      const result = await launchPlace(account, install, parsed);
      instances.markLaunched(parsed.placeId, install.logsDir);
      updatePrefs({ lastPlaceId: parsed.placeId });
      rememberLaunch(parsed.placeId);
      record("launch", { placeId: parsed.placeId, withServer: !!parsed.jobId, ...result });
      applyLaunchBehavior(readPrefs().onLaunch);
      return warning ? { ...result, warning } : result;
    },

    "launch:app": async ({ rootDir }) => {
      openRobloxApp(await findInstall(rootDir));
      log("Opened the Roblox app (no game)");
      return true as const;
    },

    "activity:start": async ({ rootDir, discordClientId, followExistingLog }) => {
      const install = await findInstall(rootDir);
      await activity.start(install.logsDir, {
        discordClientId: discordClientId && /^\d{15,25}$/.test(discordClientId) ? discordClientId : undefined,
        followExistingLog: followExistingLog === true,
      });
      return true as const;
    },

    "activity:stop": async () => {
      await activity.stop();
      log("Activity: stopped");
      return true as const;
    },

    "activity:current": () => activity.current,

    "log:history": () => logHistory(),

    "spike:report": () =>
      redact(
        JSON.stringify(
          { platform: process.platform, arch: process.arch, electron: process.versions.electron, ...report },
          null,
          2,
        ),
      ),
  };

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event)) return { ok: false, error: "Blocked sender" };

      const input = inputSchemas[channel].safeParse(raw);
      if (!input.success) {
        log(`Rejected invalid input for ${channel}`);
        return { ok: false, error: `Invalid input for ${channel}` };
      }
      try {
        const handler = handlers[channel] as (value: unknown) => unknown;
        return { ok: true, data: await handler(input.data) };
      } catch (err) {
        // The UI retries these on its own, so logging each attempt would only be noise.
        const message = errorMessage(err);
        if (message !== ROBLOX_UNREACHABLE && message !== ROBLOX_BUSY) log(`Error (${channel}): ${message}`);
        return { ok: false, error: errorMessage(err) };
      }
    });
  }

  app.on("before-quit", () => {
    void activity.stop();
    instances.stop();
  });
}
