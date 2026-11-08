// `npm run selftest`: offline checks of the spike inside real Electron.
// Never modifies the real Roblox install: mods are applied to a temp copy.
import { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BackupStore } from "../core/backup";
import { buildPresence } from "../core/discord";
import { applyFlags, FLAG_PRESETS } from "../core/fflags";
import { applyCustomFont } from "../core/fonts";
import { buildLaunchUri, buildPlaceLauncherUrl } from "../core/launchUri";
import { IDLE, parseLogLine, reduceActivity, type LogEvent } from "../core/logParser";
import { isPlayerLog } from "../core/logWatcher";
import { checkRobloxReachable } from "../core/network";
import { redact } from "../core/redact";
import { currentPlatform } from "./platform";
import { chromiumLookup } from "./robloxWeb";
import { getPageScript } from "./sessionClient";

type CheckResult = { ok: boolean; detail?: unknown };

async function hashTree(dir: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (current: string) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      hash.update(path.relative(dir, full));
      if (entry.isDirectory()) await walk(full);
      else hash.update(await readFile(full));
    }
  };
  await walk(dir);
  return hash.digest("hex");
}

export async function runSelfTest(): Promise<number> {
  const results: Record<string, CheckResult> = {};
  const check = async (name: string, fn: () => Promise<CheckResult>) => {
    try {
      results[name] = await fn();
    } catch (err) {
      results[name] = { ok: false, detail: err instanceof Error ? err.stack : String(err) };
    }
  };

  const installs = await currentPlatform().detectInstalls();
  const install = installs[0];

  await check("detectInstalls", async () => ({
    ok: installs.length > 0,
    detail: installs.map((i) => ({
      source: i.source,
      versionId: i.versionId,
      isProtocolHandler: i.isProtocolHandler,
      hasFontFamilies: i.hasFontFamilies,
      contentDirExists: existsSync(i.contentDir),
    })),
  }));

  await check("modsApplyAndRevertOnCopy", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pusar-selftest-"));
    try {
      const content = path.join(tmp, "install", "content");
      const families = path.join(content, "fonts", "families");
      if (install?.hasFontFamilies) {
        await cp(path.join(install.contentDir, "fonts", "families"), families, { recursive: true });
      } else {
        await mkdir(families, { recursive: true });
        await writeFile(
          path.join(families, "Sample.json"),
          JSON.stringify({ name: "Sample", faces: [{ name: "Regular", weight: 400, style: "normal", assetId: "rbxasset://fonts/Sample.ttf" }] }, null, "\t"),
        );
      }
      const fontFile = path.join(tmp, "Dummy.ttf");
      await writeFile(fontFile, "not a real font, only copied");
      const flagsFile = path.join(tmp, "install", "ClientSettings", "ClientAppSettings.json");

      const before = await hashTree(path.join(content, "fonts"));
      const backup = new BackupStore(path.join(tmp, "backup"));
      await applyFlags(flagsFile, FLAG_PRESETS.spikeTest!.flags, backup);
      const font = await applyCustomFont(content, fontFile, backup);
      const appliedOk = existsSync(flagsFile) && font.familiesUpdated.length > 0 && existsSync(font.fontTarget);

      await backup.restoreAll();
      const after = await hashTree(path.join(content, "fonts"));
      return {
        ok: appliedOk && before === after && !existsSync(flagsFile),
        detail: {
          familiesUpdated: font.familiesUpdated.length,
          familiesSkipped: font.familiesSkipped,
          restoredIdentical: before === after,
          flagsFileRemoved: !existsSync(flagsFile),
        },
      };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  await check("parseRealLogs", async () => {
    if (!install) return { ok: false, detail: "no install" };
    // Newest first by modification time (names sort by Roblox version, not date).
    const all = await Promise.all(
      (await readdir(install.logsDir)).filter(isPlayerLog).map(async (name) => ({
        name,
        mtime: (await stat(path.join(install.logsDir, name))).mtimeMs,
      })),
    );
    const names = all.sort((a, b) => b.mtime - a.mtime).slice(0, 200).map((f) => f.name);
    const counts: Record<string, number> = {};
    let gamesSeen = 0;
    for (const name of names) {
      let state = IDLE;
      const text = await readFile(path.join(install.logsDir, name), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const event: LogEvent | null = parseLogLine(line);
        if (!event) continue;
        counts[event.type] = (counts[event.type] ?? 0) + 1;
        const next = reduceActivity(state, event);
        if (next.status === "inGame" && state.status !== "inGame") gamesSeen++;
        state = next;
      }
    }
    return { ok: true, detail: { logsScanned: names.length, eventCounts: counts, gameSessionsReconstructed: gamesSeen } };
  });

  await check("launchUriAndRedaction", async () => {
    const uri = buildLaunchUri({
      ticket: "SELFTESTTICKET0123456789",
      placeLauncherUrl: buildPlaceLauncherUrl({ placeId: "1818" }, "1234567890"),
      browserTrackerId: "1234567890",
    });
    const redacted = redact(uri);
    return {
      ok: uri.startsWith("roblox-player:1+launchmode:play+gameinfo:") && !redacted.includes("SELFTESTTICKET"),
      detail: redacted,
    };
  });

  await check("pageScriptLoadsInIsolatedWorld", async () => {
    // Offline page with the same metadata tag roblox.com serves.
    const html = `<!doctype html><meta name="hardware-backed-authentication-data"
      data-is-secure-authentication-intent-enabled="true" data-is-bound-auth-token-enabled="false"
      data-bound-auth-token-whitelist='{"Whitelist":[{"apiSite":"auth.roblox.com","sampleRate":"100"}]}'
      data-bound-auth-token-exemptlist='{"Exemptlist":[]}' data-hba-indexed-db-name="hbaDB"
      data-hba-indexed-db-obj-store-name="hbaObjectStore" data-hba-indexed-db-key-name="hba_keys"
      data-hba-indexed-db-version="1">`;
    const win = new BrowserWindow({
      show: false,
      webPreferences: { partition: "selftest", sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const diagnosis = (await win.webContents.executeJavaScriptInIsolatedWorld(
        4242,
        [{ code: `${getPageScript()}\n;(globalThis.__pusar.diagnose())` }],
        true,
      )) as { metadataFound: boolean; whitelistSites?: string[] };
      return { ok: diagnosis.metadataFound && (diagnosis.whitelistSites?.length ?? 0) === 1, detail: diagnosis };
    } finally {
      win.destroy();
    }
  });

  await check("presencePayload", async () => {
    const payload = buildPresence(
      { status: "inGame", placeId: "1818", jobId: "00000000-0000-0000-0000-000000000000", serverType: "public", joinedAt: 1, teleporting: false },
      { universeId: "1", name: "Test Game", iconUrl: "https://tr.rbxcdn.com/x.png" },
    );
    return { ok: payload?.details === "Playing Test Game" && payload.buttons?.length === 2, detail: payload };
  });

  // Informational only: the network is outside Pusar's control, so it never fails the run.
  const network = await checkRobloxReachable(chromiumLookup);

  const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([name]) => name);
  const summary = { passed: Object.keys(results).length - failed.length, failed, robloxReachable: network, results };
  const text = redact(JSON.stringify(summary, null, 2));
  console.log(text);
  await writeFile(path.join(__dirname, "selftest-result.json"), text);
  return failed.length === 0 ? 0 : 1;
}
