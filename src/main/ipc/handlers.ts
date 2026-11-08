// Implements every IPC channel in shared/ipc.ts.
import { app, dialog, ipcMain } from "electron";
import path from "node:path";
import { BackupStore } from "../../core/backup";
import { applyFlags, FLAG_PRESETS, flagStatus, readFlags } from "../../core/fflags";
import { applyCustomFont } from "../../core/fonts";
import type { RobloxInstall } from "../../core/install";
import { parsePlaceTarget } from "../../core/launchUri";
import { redact } from "../../core/redact";
import { IPC_CHANNELS, type IpcChannel, type IpcInput, type IpcOutput, type IpcResult } from "../../shared/ipc";
import { addAccount, clientFor, getAccount, listAccounts, removeAccount } from "../accounts";
import { ActivityService } from "../activity";
import { launchPlace, openRobloxApp } from "../launcher";
import { errorMessage, log, logHistory } from "../logger";
import { currentPlatform } from "../platform";
import { ensureRobloxReachable } from "../robloxWeb";
import { isTrustedSender } from "../security";
import { getMainWindow } from "../windows";
import { inputSchemas } from "./schemas";

type Handlers = { [C in IpcChannel]: (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>> };

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

    "accounts:list": () => listAccounts(),

    "accounts:add": async () => {
      const result = await addAccount(getMainWindow() ?? undefined);
      if (result.account) record("login", { duplicate: !!result.duplicate, hba: result.diagnosis ?? null });
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

    "launch:place": async ({ accountId, rootDir, target }) => {
      const parsed = parsePlaceTarget(target);
      if (!parsed) throw new Error("Enter a place ID or a roblox.com game link");
      const account = getAccount(accountId);
      const install = await findInstall(rootDir);
      await ensureRobloxReachable();
      const result = await launchPlace(account, install, parsed);
      record("launch", { placeId: parsed.placeId, withServer: !!parsed.jobId, ...result });
      return result;
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
        log(`Error (${channel}): ${errorMessage(err)}`);
        return { ok: false, error: errorMessage(err) };
      }
    });
  }

  app.on("before-quit", () => void activity.stop());
}
