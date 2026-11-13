import { CheckIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import type { Prefs } from "../../../shared/types";
import { call } from "../api";
import { Button } from "../components/Button";
import { Switch } from "../components/Switch";
import { useToast } from "../components/Toast";
import { t } from "../i18n";
import { Logo } from "../shell/Logo";
import { useApp } from "../store";
import { messageOf } from "../errors";
import styles from "./WelcomeScreen.module.css";

/** The list's own numbering tells screen readers the order, so the marker is only visual. */
function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className={styles.step}>
      <span className={styles.marker} data-done={done} aria-hidden="true">
        {done ? <CheckIcon size={14} weight="bold" /> : number}
      </span>
      <div className={styles.body}>
        <h2 className={styles.stepTitle}>
          {title}
          {done && <span className="sr-only"> {t("welcome.done")}</span>}
        </h2>
        {children}
      </div>
    </li>
  );
}

function RobloxStep() {
  const installs = useApp((state) => state.installs);
  const detectInstalls = useApp((state) => state.detectInstalls);
  const [checking, setChecking] = useState(false);
  const found = installs.state === "ready" ? installs.value[0] : undefined;

  async function handleCheck() {
    setChecking(true);
    await detectInstalls();
    setChecking(false);
  }

  let text = t("welcome.robloxChecking");
  if (installs.state === "error") text = t("welcome.robloxFailed", { error: installs.message });
  else if (found) text = t("welcome.robloxFound", { version: (found.versionId ?? "").replace(/^version-/, "").slice(0, 8) });
  else if (installs.state === "ready") text = t("welcome.robloxMissing");

  return (
    <Step number={1} title={t("welcome.roblox")} done={!!found}>
      <p className={styles.text}>{text}</p>
      {installs.state !== "loading" && !found && (
        <div className={styles.action}>
          <Button loading={checking} onClick={() => void handleCheck()}>
            {t("common.checkAgain")}
          </Button>
        </div>
      )}
    </Step>
  );
}

function AccountStep() {
  const overview = useApp((state) => state.overview);
  const addAccount = useApp((state) => state.addAccount);
  const showToast = useToast();
  const [adding, setAdding] = useState(false);
  const account = overview.state === "ready" ? overview.value.accounts[0] : undefined;

  async function handleAdd() {
    setAdding(true);
    try {
      await addAccount();
    } catch (err) {
      showToast({ title: t("accounts.addFailed"), description: messageOf(err), tone: "error" });
    } finally {
      setAdding(false);
    }
  }

  return (
    <Step number={2} title={t("welcome.account")} done={!!account}>
      {account ? (
        <p className={styles.text}>{t("welcome.accountDone", { name: account.displayName })}</p>
      ) : (
        <>
          <p className={styles.text}>{t("welcome.accountHint")}</p>
          <div className={styles.action}>
            <Button variant="primary" loading={adding} onClick={() => void handleAdd()}>
              {t("accounts.add")}
            </Button>
          </div>
        </>
      )}
    </Step>
  );
}

function DiscordStep() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const showToast = useToast();

  useEffect(() => {
    call("prefs:get").then(setPrefs, () => setPrefs({}));
  }, []);

  async function handleChange(discordEnabled: boolean) {
    try {
      setPrefs(await call("prefs:set", { discordEnabled }));
    } catch (err) {
      showToast({ title: t("settings.saveFailed"), description: messageOf(err), tone: "error" });
    }
  }

  const enabled = prefs?.discordEnabled ?? false;
  return (
    <Step number={3} title={t("welcome.discord")} done={enabled}>
      <Switch
        label={t("settings.discord")}
        description={t("settings.discordHint")}
        checked={enabled}
        disabled={!prefs}
        onChange={(value) => void handleChange(value)}
      />
    </Step>
  );
}

/** Shown on the very first start, until it's finished or someone adds an account. */
export function WelcomeScreen() {
  const finishSetup = useApp((state) => state.finishSetup);
  const showToast = useToast();

  async function handleFinish() {
    try {
      await finishSetup();
    } catch (err) {
      showToast({ title: t("settings.saveFailed"), description: messageOf(err), tone: "error" });
    }
  }

  return (
    <section className={styles.screen} aria-labelledby="welcome-title">
      <Logo size={32} />
      <h1 id="welcome-title" className={styles.title}>
        {t("welcome.title")}
      </h1>
      <p className={styles.lead}>{t("welcome.lead")}</p>
      <ol className={styles.steps}>
        <RobloxStep />
        <AccountStep />
        <DiscordStep />
      </ol>
      <Button variant="primary" size="lg" onClick={() => void handleFinish()}>
        {t("welcome.finish")}
      </Button>
    </section>
  );
}
