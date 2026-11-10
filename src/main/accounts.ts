// Account list. Pusar stores only public profile info and the partition name;
// the session itself lives in the account's own browser partition.
import { app, session, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getUserHeadshots } from "../core/robloxApi";
import { ensureRobloxReachable } from "./robloxWeb";
import { runLoginWindow } from "./loginWindow";
import { errorMessage, log } from "./logger";
import { readPrefs } from "./prefs";
import { RobloxSessionClient } from "./sessionClient";
import type { AccountOverview, AddAccountResult, HbaDiagnosis, StoredAccount } from "../shared/types";

const storePath = () => path.join(app.getPath("userData"), "accounts.json");

const headshots = new Map<number, string>();

export function activeAccount(): StoredAccount | undefined {
  const accounts = listAccounts();
  const { activeAccountId } = readPrefs();
  return accounts.find((account) => account.id === activeAccountId) ?? accounts[0];
}

export async function accountOverview(): Promise<AccountOverview> {
  const accounts = listAccounts();
  const missing = accounts.map((account) => account.userId).filter((userId) => !headshots.has(userId));
  for (const [userId, url] of await getUserHeadshots(missing)) headshots.set(userId, url);

  const active = activeAccount();
  return {
    accounts: accounts.map((account) => ({ ...account, avatarUrl: headshots.get(account.userId) })),
    activeAccountId: active?.id ?? null,
  };
}

export function listAccounts(): StoredAccount[] {
  try {
    return JSON.parse(readFileSync(storePath(), "utf8")) as StoredAccount[];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: StoredAccount[]): void {
  writeFileSync(storePath(), JSON.stringify(accounts, null, 2));
}

export function getAccount(id: string): StoredAccount {
  const account = listAccounts().find((a) => a.id === id);
  if (!account) throw new Error("Account not found");
  return account;
}

const clients = new Map<string, RobloxSessionClient>();

export function clientFor(partition: string): RobloxSessionClient {
  let client = clients.get(partition);
  if (!client) {
    client = new RobloxSessionClient(partition);
    clients.set(partition, client);
  }
  return client;
}

/** Closes every hidden Roblox session window so they can't keep the app alive. */
export function disposeAllClients(): void {
  for (const client of clients.values()) client.dispose();
}

async function discardPartition(partition: string): Promise<void> {
  clients.get(partition)?.dispose();
  clients.delete(partition);
  await session.fromPartition(partition).clearStorageData();
}

export async function addAccount(parent?: BrowserWindow): Promise<AddAccountResult> {
  // Fail fast with a clear reason instead of opening a window that can't load.
  await ensureRobloxReachable();

  const id = randomUUID();
  const partition = `persist:acct-${id}`;

  let outcome: "success" | "cancelled";
  try {
    outcome = await runLoginWindow(partition, parent);
  } catch (err) {
    await discardPartition(partition);
    throw err;
  }
  if (outcome === "cancelled") {
    await discardPartition(partition);
    log("Login: cancelled");
    return { account: null };
  }

  const client = clientFor(partition);
  const me = await client.request({ method: "GET", url: "https://users.roblox.com/v1/users/authenticated" });
  if (me.status !== 200) {
    await discardPartition(partition);
    throw new Error(`Signed in, but Roblox would not return the profile (HTTP ${me.status}).`);
  }
  const profile = JSON.parse(me.body) as { id: number; name: string; displayName: string };

  let diagnosis: HbaDiagnosis | undefined;
  try {
    diagnosis = await client.diagnose();
  } catch (err) {
    log(`HBA diagnosis failed: ${errorMessage(err)}`);
  }

  const accounts = listAccounts();
  const existing = accounts.find((a) => a.userId === profile.id);
  if (existing) {
    // Keep the original partition; drop the duplicate session.
    await discardPartition(partition);
    log(`Login: ${profile.name} is already added`);
    return { account: existing, diagnosis, duplicate: true };
  }

  const account: StoredAccount = {
    id,
    partition,
    userId: profile.id,
    username: profile.name,
    displayName: profile.displayName,
    addedAt: new Date().toISOString(),
  };
  saveAccounts([...accounts, account]);
  log(`Login: added ${account.username}`);
  return { account, diagnosis };
}

export async function removeAccount(id: string): Promise<void> {
  const account = getAccount(id);
  try {
    // End the session on Roblox's side too, not just locally.
    const res = await clientFor(account.partition).request({ method: "POST", url: "https://auth.roblox.com/v2/logout" });
    log(`Sign-out: Roblox replied HTTP ${res.status}`);
  } catch (err) {
    log(`Sign-out request failed (${errorMessage(err)}); removing local session anyway`);
  }
  await discardPartition(account.partition);
  saveAccounts(listAccounts().filter((a) => a.id !== id));
  log(`Removed ${account.username}`);
}
