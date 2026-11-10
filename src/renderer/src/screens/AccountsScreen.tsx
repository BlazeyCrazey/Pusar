import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { AccountView } from "../../../shared/types";
import { Avatar } from "../components/Avatar";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { IconButton } from "../components/IconButton";
import { useToast } from "../components/Toast";
import { useApp } from "../store";
import styles from "./AccountsScreen.module.css";

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
          title: duplicate ? `${account.displayName} was already added` : `Signed in as ${account.displayName}`,
          tone: "ok",
        });
      }
    } catch (err) {
      showToast({ title: "Couldn't add that account", description: messageOf(err), tone: "error" });
    } finally {
      setAdding(false);
    }
  }

  async function handleUse(account: AccountView) {
    try {
      await setActiveAccount(account.id);
    } catch (err) {
      showToast({ title: "Couldn't switch accounts", description: messageOf(err), tone: "error" });
    }
  }

  async function handleRemove() {
    if (!toRemove) return;
    setRemoving(true);
    try {
      await removeAccount(toRemove.id);
      showToast({ title: `Removed ${toRemove.displayName}`, tone: "ok" });
      setToRemove(null);
    } catch (err) {
      showToast({ title: "Couldn't remove that account", description: messageOf(err), tone: "error" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Accounts</h1>
        <Button variant="primary" icon={<PlusIcon size={16} />} loading={adding} onClick={() => void handleAdd()}>
          Add account
        </Button>
      </header>

      {overview.state === "error" && <p className={styles.error}>{overview.message}</p>}

      {overview.state === "ready" && accounts.length === 0 && (
        <p className={styles.empty}>Add your Roblox account to launch games from Pusar.</p>
      )}

      {accounts.length > 0 && (
        <ul className={styles.list}>
          {accounts.map((account) => (
            <li key={account.id} className={styles.row}>
              <Avatar name={account.displayName} src={account.avatarUrl} size={44} />
              <div className={styles.names}>
                <span className={styles.displayName}>{account.displayName}</span>
                <span className={styles.username}>@{account.username}</span>
              </div>
              {account.id === activeId ? (
                <Badge tone="ok">Active</Badge>
              ) : (
                <Button variant="ghost" onClick={() => void handleUse(account)}>
                  Use this account
                </Button>
              )}
              <IconButton
                label={`Remove ${account.displayName}`}
                icon={<TrashIcon />}
                onClick={() => setToRemove(account)}
              />
            </li>
          ))}
        </ul>
      )}

      <p className={styles.hint}>
        You sign in on Roblox's own page, and your password never reaches Pusar. If the "verify you're human" check gets
        stuck, choose <strong>Email a code</strong> or <strong>QR code</strong> on that page instead.
      </p>

      <Dialog
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setToRemove(null);
        }}
        title={`Remove ${toRemove?.displayName ?? "this account"}?`}
        description="You'll be signed out of Roblox on this device."
        actions={
          <>
            <Button variant="ghost" disabled={removing} onClick={() => setToRemove(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={removing} onClick={() => void handleRemove()}>
              Remove
            </Button>
          </>
        }
      />
    </section>
  );
}
