import { Progress } from "../components/Progress";
import { t } from "../i18n";
import { useApp, type Loaded } from "../store";
import type { AccountOverview, RobloxInstall } from "../../../shared/types";
import styles from "./StatusBar.module.css";

function shortVersion(versionId: string | null): string {
  return versionId ? versionId.replace(/^version-/, "").slice(0, 8) : t("status.unknownVersion");
}

function RobloxStatus({ installs }: { installs: Loaded<RobloxInstall[]> }) {
  if (installs.state === "loading") return <span className={styles.item}>{t("status.checkingRoblox")}</span>;
  if (installs.state === "error") {
    return (
      <span className={styles.item}>
        <i className={styles.dot} data-tone="danger" />
        {t("status.robloxCheckFailed")}
      </span>
    );
  }
  const [current] = installs.value;
  if (!current) {
    return (
      <span className={styles.item}>
        <i className={styles.dot} data-tone="warn" />
        {t("status.robloxMissing")}
      </span>
    );
  }
  return (
    <span className={styles.item}>
      <i className={styles.dot} data-tone="ok" />
      {t("status.robloxVersion", { version: shortVersion(current.versionId) })}
    </span>
  );
}

function accountLabel(overview: Loaded<AccountOverview>): string {
  if (overview.state !== "ready") return "";
  const { accounts, activeAccountId } = overview.value;
  const active = accounts.find((account) => account.id === activeAccountId);
  return active ? t("status.account", { username: active.username }) : t("status.noAccount");
}

export function StatusBar() {
  const installs = useApp((state) => state.installs);
  const overview = useApp((state) => state.overview);
  const launchingGame = useApp((state) => state.launchingGame);
  const instanceStatus = useApp((state) => state.instance.status);
  const region = useApp((state) => state.activity?.region);
  const updateReady = useApp((state) => state.update.state === "ready");
  const installUpdate = useApp((state) => state.installUpdate);

  return (
    <footer className={styles.bar}>
      {launchingGame && (
        <div className={styles.progress}>
          <Progress label={t("status.starting", { game: launchingGame })} />
        </div>
      )}
      <RobloxStatus installs={installs} />
      {launchingGame && <span className={styles.item}>{t("status.starting", { game: launchingGame })}</span>}
      {!launchingGame && instanceStatus === "running" && (
        <span className={styles.item}>{region ? t("status.inGameAt", { region }) : t("status.inGame")}</span>
      )}
      <span className={styles.end}>
        {updateReady && (
          <button type="button" className={styles.update} onClick={() => void installUpdate()}>
            {t("status.updateReady")}
          </button>
        )}
        <span className={styles.item}>{accountLabel(overview)}</span>
      </span>
    </footer>
  );
}
