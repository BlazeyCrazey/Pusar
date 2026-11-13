// Gathers what "Copy diagnostics" reports. Account names and the Windows user
// name are blanked out, and credentials never reach the log in the first place.
import { app, clipboard } from "electron";
import os from "node:os";
import { buildDiagnostics } from "../core/diagnostics";
import { listAccounts } from "./accounts";
import { logHistory } from "./logger";
import { mods } from "./mods";
import { currentPlatform } from "./platform";
import { readPrefs } from "./prefs";

const LOG_LINES = 200;

export async function copyDiagnostics(instanceStatus: string): Promise<void> {
  const accounts = listAccounts();
  const [installs, overview] = await Promise.all([
    currentPlatform()
      .detectInstalls()
      .catch(() => []),
    mods()
      .overview()
      .catch(() => null),
  ]);

  const report = buildDiagnostics({
    version: app.getVersion(),
    electron: process.versions.electron ?? "unknown",
    os: `${os.type()} ${os.release()} ${process.arch}`,
    installs: installs.map((install) => ({ source: install.source, versionId: install.versionId })),
    settings: { ...readPrefs() },
    mods: overview && {
      enabled: overview.enabled,
      flags: overview.flags.length,
      packs: overview.packs.length,
      font: overview.font !== null,
    },
    instance: instanceStatus,
    accountCount: accounts.length,
    privateNames: [...accounts.flatMap((account) => [account.username, account.displayName]), os.userInfo().username],
    log: logHistory().slice(-LOG_LINES),
  });
  clipboard.writeText(report);
}
