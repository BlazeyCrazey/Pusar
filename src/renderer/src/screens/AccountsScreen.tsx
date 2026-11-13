import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { AccountView } from "../../../shared/types";
import { Avatar } from "../components/Avatar";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { IconButton } from "../components/IconButton";
import { useToast } from "../components/Toast";
import { messageOf } from "../errors";
import { t, tRich } from "../i18n";
import { useApp } from "../store";
import styles from "./AccountsScreen.module.css";

export function AccountsScreen() {
  const overview = useApp((state) => state.overview);
  const addAccount = useApp((state) => state.addAccount);
  const removeAccount = useApp((state) => state.removeAccount);
  const setActiveAccount = useApp((state) => state.setActiveAccount);
  const showToast = useToast();

  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toRemove, setToRemove] = useState<AccountView | null>(null);

  const accounts = overview.state === "ready" ? overview.value.accounts : [];
  const activeId = overview.state === "ready" ? overview.value.activeAccountId : null;

  async function handleAdd() {
    setAdding(true);
    try {
      const { account, duplicate } = await addAccount();
      if (account) {
        showToast({
          title: duplicate
            ? t("accounts.alreadyAdded", { name: account.displayName })
            : t("accounts.signedIn", { name: account.displayName }),
          tone: "ok",
        });
      }
    } catch (err) {
      showToast({ title: t("accounts.addFailed"), description: messageOf(err), tone: "error" });
    } finally {
      setAdding(false);
    }
  }

  async function handleUse(account: AccountView) {
    try {
      await setActiveAccount(account.id);
    } catch (err) {
      showToast({ title: t("accounts.switchFailed"), description: messageOf(err), tone: "error" });
    }
  }

  async function handleRemove() {
    if (!toRemove) return;
    setRemoving(true);
    try {
      await removeAccount(toRemove.id);
      showToast({ title: t("accounts.removed", { name: toRemove.displayName }), tone: "ok" });
      setToRemove(null);
    } catch (err) {
      showToast({ title: t("accounts.removeFailed"), description: messageOf(err), tone: "error" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("accounts.title")}</h1>
        <Button variant="primary" icon={<PlusIcon size={16} />} loading={adding} onClick={() => void handleAdd()}>
          {t("accounts.add")}
        </Button>
      </header>

      {overview.state === "error" && <p className={styles.error}>{overview.message}</p>}

      {overview.state === "ready" && accounts.length === 0 && <p className={styles.empty}>{t("accounts.empty")}</p>}

      {accounts.length > 0 && (
        <ul className={styles.list}>
          {accounts.map((account) => (
            <li key={account.id} className={styles.row}>
              <Avatar name={account.displayName} src={account.avatarUrl} size={44} />
              <div className={styles.names}>
                <span className={styles.displayName}>{account.displayName}</span>
                <span className={styles.username}>{t("common.username", { username: account.username })}</span>
              </div>
              {account.id === activeId ? (
                <Badge tone="ok">{t("accounts.active")}</Badge>
              ) : (
                <Button variant="ghost" onClick={() => void handleUse(account)}>
                  {t("accounts.use")}
                </Button>
              )}
              <IconButton
                label={t("accounts.remove", { name: account.displayName })}
                icon={<TrashIcon />}
                onClick={() => setToRemove(account)}
              />
            </li>
          ))}
        </ul>
      )}

      <p className={styles.hint}>
        {tRich("accounts.hint", {
          emailCode: <strong>{t("accounts.hintEmailCode")}</strong>,
          qrCode: <strong>{t("accounts.hintQrCode")}</strong>,
        })}
      </p>

      <Dialog
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setToRemove(null);
        }}
        title={t("accounts.removeTitle", { name: toRemove?.displayName ?? t("accounts.removeThisAccount") })}
        description={t("accounts.removeBody")}
        actions={
          <>
            <Button variant="ghost" disabled={removing} onClick={() => setToRemove(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={removing} onClick={() => void handleRemove()}>
              {t("accounts.removeConfirm")}
            </Button>
          </>
        }
      />
    </section>
  );
}
