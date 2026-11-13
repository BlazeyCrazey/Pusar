import { PlayIcon, StarIcon, XCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { GameDetails, ResolvedGame } from "../../../../shared/types";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { messageOf } from "../../errors";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { formatPlayers, GameArt } from "./GameArt";
import styles from "./GameHero.module.css";

/** Shown instead of Launch while Roblox is running, because a second launch fails with error 429. */
function KillControls({ placeId }: { placeId: string }) {
  const instance = useApp((state) => state.instance);
  const killInstance = useApp((state) => state.killInstance);
  const region = useApp((state) => state.activity?.region);
  const showToast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [killing, setKilling] = useState(false);

  let note = t("game.running");
  if (instance.placeId !== placeId) note = t("game.otherRunning");
  else if (instance.status === "starting") note = t("game.starting");
  if (region && instance.placeId === placeId) note = `${note} ${t("game.server", { region })}`;

  async function handleKill() {
    setKilling(true);
    try {
      await killInstance();
      showToast({ title: t("game.killed"), tone: "ok" });
      setConfirming(false);
    } catch (err) {
      showToast({ title: t("game.killFailed"), description: messageOf(err), tone: "error" });
    } finally {
      setKilling(false);
    }
  }

  return (
    <div className={styles.controls}>
      <p className={styles.note}>{note}</p>
      <Button variant="danger" size="lg" icon={<XCircleIcon size={18} />} onClick={() => setConfirming(true)}>
        {t("game.kill")}
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !killing) setConfirming(false);
        }}
        title={t("game.killTitle")}
        description={t("game.killBody")}
        actions={
          <>
            <Button variant="ghost" disabled={killing} onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={killing} onClick={() => void handleKill()}>
              {t("game.kill")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function LaunchControls() {
  const overview = useApp((state) => state.overview);
  const installs = useApp((state) => state.installs);
  const launchingGame = useApp((state) => state.launchingGame);
  const launch = useApp((state) => state.launch);
  const setActiveAccount = useApp((state) => state.setActiveAccount);
  const detectInstalls = useApp((state) => state.detectInstalls);
  const setView = useApp((state) => state.setView);
  const showToast = useToast();
  const [checking, setChecking] = useState(false);

  if (overview.state !== "ready") return null;
  const { accounts, activeAccountId } = overview.value;

  if (accounts.length === 0) {
    return (
      <div className={styles.controls}>
        <p className={styles.note}>{t("game.needAccount")}</p>
        <Button variant="primary" size="lg" onClick={() => setView("accounts")}>
          {t("accounts.add")}
        </Button>
      </div>
    );
  }

  const robloxMissing = installs.state === "ready" && installs.value.length === 0;

  async function handleLaunch() {
    try {
      const warning = await launch();
      if (warning) showToast({ title: t("game.launchModsFailed"), description: warning, tone: "error" });
      else showToast({ title: t("game.launchStarted"), tone: "ok" });
    } catch (err) {
      showToast({ title: t("game.launchFailed"), description: messageOf(err), tone: "error" });
    }
  }

  async function handleCheck() {
    setChecking(true);
    await detectInstalls();
    setChecking(false);
  }

  return (
    <div className={styles.controls}>
      <Select
        label={t("game.account")}
        value={activeAccountId ?? undefined}
        onChange={(id) => void setActiveAccount(id)}
        options={accounts.map((account) => ({
          value: account.id,
          label:
            account.displayName === account.username
              ? t("common.username", { username: account.username })
              : t("game.accountName", { displayName: account.displayName, username: account.username }),
        }))}
      />
      <Button
        variant="primary"
        size="lg"
        icon={<PlayIcon weight="fill" size={18} />}
        loading={launchingGame !== null}
        disabled={robloxMissing}
        onClick={() => void handleLaunch()}
      >
        {launchingGame ? t("game.launching") : t("game.launch")}
      </Button>
      {robloxMissing && (
        <div className={styles.missing}>
          <p className={styles.note}>{t("game.robloxMissing")}</p>
          <Button variant="ghost" loading={checking} onClick={() => void handleCheck()}>
            {t("common.checkAgain")}
          </Button>
        </div>
      )}
    </div>
  );
}

function FavoriteButton({ game }: { game: GameDetails }) {
  const favorite = useApp(
    (state) => state.library.state === "ready" && state.library.value.favorites.some((item) => item.universeId === game.universeId),
  );
  const setFavorite = useApp((state) => state.setFavorite);
  const showToast = useToast();

  async function handleToggle() {
    try {
      await setFavorite(game, !favorite);
    } catch (err) {
      showToast({ title: t("game.favoriteFailed"), description: messageOf(err), tone: "error" });
    }
  }

  return (
    <IconButton
      label={favorite ? t("game.removeFavorite") : t("game.addFavorite")}
      className={favorite ? styles.favorite : undefined}
      icon={<StarIcon size={20} weight={favorite ? "fill" : "regular"} />}
      onClick={() => void handleToggle()}
    />
  );
}

export function GameHero({ selected }: { selected: ResolvedGame }) {
  const { game, target } = selected;
  const instanceActive = useApp((state) => state.instance.status !== "idle");
  return (
    <section className={styles.hero} aria-label={t("game.selected")}>
      <GameArt src={game.thumbnailUrl} name={game.name} />
      <div className={styles.info}>
        <div className={styles.heading}>
          <h2 className={styles.name}>{game.name}</h2>
          <FavoriteButton game={game} />
        </div>
        {game.creatorName && <p className={styles.creator}>{t("game.by", { creator: game.creatorName })}</p>}
        <div className={styles.meta}>
          {game.playing !== undefined && <span>{formatPlayers(game.playing)}</span>}
          {target.jobId && <Badge>{t("game.specificServer")}</Badge>}
        </div>
        {game.description && <p className={styles.description}>{game.description}</p>}
        {instanceActive ? <KillControls placeId={target.placeId} /> : <LaunchControls />}
      </div>
    </section>
  );
}
