import { Progress } from "../components/Progress";
import { useApp, type Loaded } from "../store";
import type { AccountOverview, RobloxInstall } from "../../../shared/types";
import styles from "./StatusBar.module.css";

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
  const [current] = installs.value;
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

function accountLabel(overview: Loaded<AccountOverview>): string {
  if (overview.state !== "ready") return "";
  const { accounts, activeAccountId } = overview.value;
  const active = accounts.find((account) => account.id === activeAccountId);
  return active ? `@${active.username}` : "No account added";
}

export function StatusBar() {
  const installs = useApp((state) => state.installs);
  const overview = useApp((state) => state.overview);
  const launchingGame = useApp((state) => state.launchingGame);
  const instanceStatus = useApp((state) => state.instance.status);
  const region = useApp((state) => state.activity?.region);

  return (
    <footer className={styles.bar}>
      {launchingGame && (
        <div className={styles.progress}>
          <Progress label={`Starting ${launchingGame}`} />
        </div>
      )}
      <RobloxStatus installs={installs} />
      {launchingGame && <span className={styles.item}>Starting {launchingGame}</span>}
      {!launchingGame && instanceStatus === "running" && <span className={styles.item}>In game{region && ` · ${region}`}</span>}
      <span className={styles.item}>{accountLabel(overview)}</span>
    </footer>
  );
}
