// Pusar M0 spike: Electron main process.
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { BackupStore } from "../core/backup";
import { applyFlags, FLAG_PRESETS, flagStatus, readFlags } from "../core/fflags";
import { applyCustomFont } from "../core/fonts";
import { detectInstalls, type RobloxInstall } from "../core/install";
import { parsePlaceTarget } from "../core/launchUri";
import { ensureRobloxReachable } from "./robloxWeb";
import { redact } from "../core/redact";
import { addAccount, clientFor, disposeAllClients, getAccount, listAccounts, removeAccount } from "./accounts";
import { ActivityService } from "./activity";
import { launchPlace, spawnRoblox } from "./launcher";
import { errorMessage, log, logHistory, onLog } from "./logger";
import { runSelfTest } from "./selftest";

// Roblox's site should see a normal Chrome user agent, not "Electron/x Pusar/x".
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:pusar|Pusar|Electron)\/\S+/g, "");

let panel: BrowserWindow | null = null;

// ---- spike report (what worked, for docs/M0-SPIKES.md) ----------------------

const report: Record<string, unknown> = {};
function record(key: string, value: unknown): void {
  report[key] = { at: new Date().toISOString(), value };
}

// ---- helpers -----------------------------------------------------------------

const backupsRoot = () => path.join(app.getPath("userData"), "backups");

async function findInstall(rootDir?: string): Promise<RobloxInstall> {
  const installs = await detectInstalls();
  const found = rootDir ? installs.find((i) => i.rootDir === rootDir) : installs[0];
  if (!found) {
    throw new Error(
      rootDir ? "That Roblox install is gone (Roblox may have updated). Click Detect again." : "Roblox is not installed.",
    );
  }
  return found;
}

function send(channel: string, payload: unknown): void {
  if (panel && !panel.isDestroyed()) panel.webContents.send(channel, payload);
}

type Payload = Record<string, unknown>;

function handle(channel: string, fn: (payload: Payload, event: IpcMainInvokeEvent) => unknown): void {
  ipcMain.handle(channel, async (event, payload: Payload | undefined) => {
    // Only our own panel page may call these.
    if (!event.senderFrame?.url.startsWith("file://")) return { ok: false, error: "Blocked sender" };
    try {
      return { ok: true, data: await fn(payload ?? {}, event) };
    } catch (err) {
      log(`Error (${channel}): ${errorMessage(err)}`);
      return { ok: false, error: errorMessage(err) };
    }
  });
}

const str = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name}`);
  return value;
};

// ---- IPC ----------------------------------------------------------------------

function registerIpc(): void {
  const activity = new ActivityService((update) => {
    send("activity", update);
    if (update.state.status === "inGame") {
      record("activity.inGame", {
        game: update.game?.name ?? null,
        serverType: update.state.serverType,
        presence: update.presence,
      });
    }
  });

  handle("install:detect", async () => {
    const installs = await detectInstalls();
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
  });

  handle("mods:status", async ({ rootDir }) => {
    const install = await findInstall(str(rootDir, "rootDir"));
    const flags = await readFlags(install.clientSettingsFile);
    const backup = BackupStore.forInstall(backupsRoot(), install.rootDir);
    return {
      flags: Object.entries(flags).map(([name, value]) => ({ name, value, status: flagStatus(name) })),
      changedFiles: (await backup.entries()).length,
    };
  });

  handle("mods:applyFlags", async ({ rootDir, preset }) => {
    const install = await findInstall(str(rootDir, "rootDir"));
    const chosen = FLAG_PRESETS[str(preset, "preset")];
    if (!chosen) throw new Error("Unknown preset");
    const backup = BackupStore.forInstall(backupsRoot(), install.rootDir);
    const written = await applyFlags(install.clientSettingsFile, chosen.flags, backup);
    log(`FFlags: wrote ${Object.keys(chosen.flags).length} flag(s) to ${install.clientSettingsFile}`);
    record("mods.flags", { file: install.clientSettingsFile, written });
    return written;
  });

  handle("mods:applyFont", async ({ rootDir }) => {
    const install = await findInstall(str(rootDir, "rootDir"));
    const fontsDefault = process.platform === "win32" ? "C:\\Windows\\Fonts" : "/System/Library/Fonts/Supplemental";
    const pick = await dialog.showOpenDialog(panel!, {
      title: "Choose a font for Roblox's UI",
      defaultPath: fontsDefault,
      filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
      properties: ["openFile"],
    });
    const fontFile = pick.filePaths[0];
    if (pick.canceled || !fontFile) return null;
    const backup = BackupStore.forInstall(backupsRoot(), install.rootDir);
    const result = await applyCustomFont(install.contentDir, fontFile, backup);
    log(`Font: applied ${path.basename(fontFile)} to ${result.familiesUpdated.length} families`);
    record("mods.font", {
      font: path.basename(fontFile),
      familiesUpdated: result.familiesUpdated.length,
      familiesSkipped: result.familiesSkipped,
    });
    return result;
  });

  handle("mods:revert", async ({ rootDir }) => {
    const install = await findInstall(str(rootDir, "rootDir"));
    const result = await BackupStore.forInstall(backupsRoot(), install.rootDir).restoreAll();
    log(`Revert: restored ${result.restored} file(s), removed ${result.removed} added file(s)`);
    record("mods.revert", result);
    return result;
  });

  handle("accounts:list", () => listAccounts());

  handle("accounts:add", async () => {
    const result = await addAccount(panel ?? undefined);
    if (result.account) {
      record("login", { duplicate: !!result.duplicate, hba: result.diagnosis ?? null });
    }
    return result;
  });

  handle("accounts:remove", async ({ id }) => {
    await removeAccount(str(id, "id"));
    return listAccounts();
  });

  handle("accounts:diagnose", async ({ id }) => {
    await ensureRobloxReachable();
    const account = getAccount(str(id, "id"));
    const client = clientFor(account.partition);
    const hasCookie = await client.hasSessionCookie();
    const diagnosis = await client.diagnose();
    const me = await client.request({ method: "GET", url: "https://users.roblox.com/v1/users/authenticated" });
    const result = { hasCookie, profileRequest: { status: me.status, signed: me.signed }, hba: diagnosis };
    record("diagnose", result);
    log(`Diagnose ${account.username}: session=${hasCookie}, profile HTTP ${me.status}, signed=${me.signed}, keyPair=${diagnosis.hasKeyPair}`);
    log(
      `Diagnose signing rules: secureAuthIntent=${diagnosis.secureAuthIntentEnabled}, allUrls=${diagnosis.batEnabledForAllUrls}, ` +
        `signed sites=[${(diagnosis.whitelistSites ?? []).join(", ")}], exempt=[${(diagnosis.exemptSites ?? []).join(", ")}]`,
    );
    return result;
  });

  handle("launch:place", async ({ accountId, rootDir, target }) => {
    const parsed = parsePlaceTarget(str(target, "place"));
    if (!parsed) throw new Error("Enter a place ID or a roblox.com game link");
    const account = getAccount(str(accountId, "account"));
    const install = await findInstall(str(rootDir, "rootDir"));
    await ensureRobloxReachable();
    const result = await launchPlace(account, install, parsed);
    record("launch", { placeId: parsed.placeId, withServer: !!parsed.jobId, ...result });
    return result;
  });

  handle("launch:app", async ({ rootDir }) => {
    const install = await findInstall(str(rootDir, "rootDir"));
    spawnRoblox(install);
    log("Opened the Roblox app (no game)");
    return true;
  });

  handle("activity:start", async ({ rootDir, discordClientId, followExistingLog }) => {
    const install = await findInstall(str(rootDir, "rootDir"));
    await activity.start(install.logsDir, {
      discordClientId: typeof discordClientId === "string" && /^\d{15,25}$/.test(discordClientId) ? discordClientId : undefined,
      followExistingLog: followExistingLog === true,
    });
    return true;
  });

  handle("activity:stop", async () => {
    await activity.stop();
    log("Activity: stopped");
    return true;
  });

  handle("log:history", () => logHistory());

  handle("spike:report", () =>
    redact(
      JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          ...report,
        },
        null,
        2,
      ),
    ),
  );

  app.on("before-quit", () => void activity.stop());
}

// ---- windows -------------------------------------------------------------------

function createPanel(): void {
  panel = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Pusar · M0 spike panel",
    backgroundColor: "#121316",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  panel.webContents.on("will-navigate", (event) => event.preventDefault());
  panel.on("closed", () => {
    panel = null;
    // Hidden Roblox session windows count as open windows, so without this
    // the app would keep running invisibly and block every later start.
    disposeAllClients();
    app.quit();
  });
  void panel.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// ---- startup -------------------------------------------------------------------

if (process.argv.includes("--selftest")) {
  // The self-test opens and closes hidden windows; without this listener
  // Electron quits as soon as the last one closes, before results are written.
  app.on("window-all-closed", () => {});
  app.whenReady().then(async () => {
    const code = await runSelfTest();
    app.exit(code);
  });
} else if (!app.requestSingleInstanceLock()) {
  console.log("Pusar is already running, so this copy is exiting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (panel?.isMinimized()) panel.restore();
    panel?.focus();
  });
  app.whenReady().then(() => {
    onLog((line) => send("log", line));
    registerIpc();
    createPanel();
    log(`Pusar spike started (Electron ${process.versions.electron}, ${process.platform}/${process.arch})`);
  });
  app.on("window-all-closed", () => app.quit());
}
