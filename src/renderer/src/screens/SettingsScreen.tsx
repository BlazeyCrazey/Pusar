import { useEffect, useState } from "react";
import type { AboutInfo, LaunchBehavior, LinkHandlerStatus, Prefs, Settings, UpdateStatus } from "../../../shared/types";
import { call } from "../api";
import { Button } from "../components/Button";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
import { useToast } from "../components/Toast";
import { messageOf } from "../errors";
import { t, type MessageKey } from "../i18n";
import { useApp } from "../store";
import styles from "./SettingsScreen.module.css";

const LAUNCH_OPTIONS: Array<{ value: LaunchBehavior; label: MessageKey; note: MessageKey }> = [
  { value: "stay", label: "settings.onLaunchStay", note: "settings.onLaunchStayNote" },
  { value: "tray", label: "settings.onLaunchTray", note: "settings.onLaunchTrayNote" },
  { value: "close", label: "settings.onLaunchClose", note: "settings.onLaunchCloseNote" },
];

function updateText(status: UpdateStatus): string {
  switch (status.state) {
    case "unsupported":
      return t("settings.updatesUnsupported");
    case "idle":
      return t("settings.updatesIdle");
    case "checking":
      return t("settings.updatesChecking");
    case "upToDate":
      return t("settings.updatesUpToDate");
    case "downloading":
      return t("settings.updatesDownloading", { version: status.version, percent: status.percent });
    case "ready":
      return t("settings.updatesReady", { version: status.version });
    case "error":
      return t("settings.updatesError");
  }
}

function AboutGroup({ prefs, save }: { prefs: Prefs | null; save: (changes: Partial<Settings>) => Promise<void> }) {
  const update = useApp((state) => state.update);
  const checkForUpdates = useApp((state) => state.checkForUpdates);
  const installUpdate = useApp((state) => state.installUpdate);
  const showToast = useToast();
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    call("app:about").then(setAbout, () => {});
  }, []);

  async function handleCopy() {
    setCopying(true);
    try {
      await call("diagnostics:copy");
      showToast({ title: t("settings.diagnosticsCopied"), tone: "ok" });
    } catch (err) {
      showToast({ title: t("settings.diagnosticsFailed"), description: messageOf(err), tone: "error" });
    } finally {
      setCopying(false);
    }
  }

  const busy = update.state === "checking" || update.state === "downloading";
  const runningBeta = about?.version.includes("-") ?? false;

  return (
    <div className={styles.group}>
      <h2 className={styles.groupTitle}>{t("settings.about")}</h2>
      <div className={styles.row}>
        <div className={styles.rowText}>
          {about && <span>{t("settings.version", { version: about.version })}</span>}
          <span className={styles.note} role="status">
            {updateText(update)}
          </span>
        </div>
        {update.state === "ready" ? (
          <Button variant="primary" onClick={() => void installUpdate()}>
            {t("settings.restartToUpdate")}
          </Button>
        ) : (
          update.state !== "unsupported" && (
            <Button loading={busy} onClick={() => void checkForUpdates()}>
              {t("settings.checkUpdates")}
            </Button>
          )
        )}
      </div>
      <div className={styles.spaced}>
        <Switch
          label={t("settings.beta")}
          description={runningBeta ? t("settings.betaRunning") : t("settings.betaHint")}
          checked={runningBeta || (prefs?.betaUpdates ?? false)}
          disabled={!prefs || update.state === "unsupported" || runningBeta}
          onChange={(betaUpdates) => void save({ betaUpdates })}
        />
      </div>
      <div className={`${styles.row} ${styles.spaced}`}>
        <span className={styles.rowText}>
          <span>{t("settings.bugReports")}</span>
          <span className={styles.note}>{t("settings.diagnosticsHint")}</span>
        </span>
        <Button loading={copying} onClick={() => void handleCopy()}>
          {t("settings.diagnostics")}
        </Button>
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const [status, setStatus] = useState<LinkHandlerStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const showToast = useToast();

  function showError(err: unknown) {
    showToast({ title: t("settings.saveFailed"), description: messageOf(err), tone: "error" });
  }

  useEffect(() => {
    call("linkHandler:status").then(setStatus, () => setStatus({ supported: false, enabled: false }));
    call("prefs:get").then(setPrefs, () => setPrefs({}));
  }, []);

  async function handleLinkToggle(enabled: boolean) {
    setSaving(true);
    try {
      setStatus(await call("linkHandler:set", { enabled }));
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function save(changes: Partial<Settings>) {
    try {
      setPrefs(await call("prefs:set", changes));
    } catch (err) {
      showError(err);
    }
  }

  const onLaunch = LAUNCH_OPTIONS.find((option) => option.value === (prefs?.onLaunch ?? "stay")) ?? LAUNCH_OPTIONS[0]!;

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{t("settings.title")}</h1>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>{t("settings.launching")}</h2>
        <Select
          label={t("settings.onLaunch")}
          value={onLaunch.value}
          disabled={!prefs}
          onChange={(value) => void save({ onLaunch: value as LaunchBehavior })}
          options={LAUNCH_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
        />
        <p className={styles.note}>{t(onLaunch.note)}</p>
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>{t("settings.whilePlaying")}</h2>
        <Switch
          label={t("settings.discord")}
          description={t("settings.discordHint")}
          checked={prefs?.discordEnabled ?? false}
          disabled={!prefs}
          onChange={(discordEnabled) => void save({ discordEnabled })}
        />
        <div className={styles.spaced}>
          <Switch
            label={t("settings.region")}
            description={t("settings.regionHint")}
            checked={prefs?.showServerRegion ?? false}
            disabled={!prefs}
            onChange={(showServerRegion) => void save({ showServerRegion })}
          />
        </div>
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>{t("settings.links")}</h2>
        <Switch
          label={t("settings.linkHandler")}
          description={t("settings.linkHandlerHint")}
          checked={status?.enabled ?? false}
          disabled={!status?.supported || saving}
          onChange={(enabled) => void handleLinkToggle(enabled)}
        />
        {status && !status.supported && <p className={styles.note}>{t("settings.linkHandlerUnsupported")}</p>}
      </div>

      <AboutGroup prefs={prefs} save={save} />
    </section>
  );
}
