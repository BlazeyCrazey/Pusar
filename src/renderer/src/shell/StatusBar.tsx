import { useEffect, useState } from "react";
import type { RobloxInstall, StoredAccount } from "../../../shared/types";
import { call } from "../api";
import styles from "./StatusBar.module.css";

type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error" };

function shortVersion(versionId: string | null): string {
  return versionId ? versionId.replace(/^version-/, "").slice(0, 8) : "unknown version";
}

function RobloxStatus({ installs }: { installs: Loaded<RobloxInstall[]> }) {
  if (installs.state === "loading") return <span className={styles.item}>Checking for Roblox</span>;
  if (installs.state === "error") {
    return (
      <span className={styles.item}>
        <i className={styles.dot} data-tone="danger" />
        Couldn't check for Roblox
      </span>
    );
  }
  const current = installs.value[0];
  if (!current) {
    return (
      <span className={styles.item}>
        <i className={styles.dot} data-tone="warn" />
        Roblox not installed
      </span>
    );
  }
  return (
    <span className={styles.item}>
      <i className={styles.dot} data-tone="ok" />
      Roblox {shortVersion(current.versionId)}
    </span>
  );
}

function accountLabel(accounts: Loaded<StoredAccount[]>): string {
  if (accounts.state !== "ready") return "";
  const [first] = accounts.value;
  if (!first) return "No account added";
  return accounts.value.length === 1 ? `@${first.username}` : `${accounts.value.length} accounts`;
}

export function StatusBar() {
  const [installs, setInstalls] = useState<Loaded<RobloxInstall[]>>({ state: "loading" });
  const [accounts, setAccounts] = useState<Loaded<StoredAccount[]>>({ state: "loading" });

  useEffect(() => {
    call("install:detect").then(
      (value) => setInstalls({ state: "ready", value }),
      () => setInstalls({ state: "error" }),
    );
    call("accounts:list").then(
      (value) => setAccounts({ state: "ready", value }),
      () => setAccounts({ state: "error" }),
    );
  }, []);

  return (
    <footer className={styles.bar}>
      <RobloxStatus installs={installs} />
      <span className={styles.item}>{accountLabel(accounts)}</span>
    </footer>
  );
}
