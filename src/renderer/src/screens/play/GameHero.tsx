import { PlayIcon, StarIcon, XCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { GameDetails, ResolvedGame } from "../../../../shared/types";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { useApp } from "../../store";
import { formatPlayers, GameArt } from "./GameArt";
import styles from "./GameHero.module.css";

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Shown instead of Launch while Roblox is running, because a second launch fails with error 429. */
function KillControls({ placeId }: { placeId: string }) {
  const instance = useApp((state) => state.instance);
  const killInstance = useApp((state) => state.killInstance);
  const region = useApp((state) => state.activity?.region);
  const showToast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [killing, setKilling] = useState(false);

  let note = "This game is running.";
  if (instance.placeId !== placeId) note = "Another game is running. Kill it to launch this one.";
  else if (instance.status === "starting") note = "Roblox is starting.";

  async function handleKill() {
    setKilling(true);
    try {
      await killInstance();
      showToast({ title: "Roblox closed", tone: "ok" });
      setConfirming(false);
    } catch (err) {
      showToast({ title: "Couldn't close Roblox", description: messageOf(err), tone: "error" });
    } finally {
      setKilling(false);
    }
  }

  return (
    <div className={styles.controls}>
      <p className={styles.note}>
        {note}
        {region && instance.placeId === placeId && ` Server: ${region}.`}
      </p>
      <Button variant="danger" size="lg" icon={<XCircleIcon size={18} />} onClick={() => setConfirming(true)}>
        Kill Instance
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !killing) setConfirming(false);
        }}
        title="Kill this Roblox instance?"
        description="Roblox will close immediately, and anything unsaved in your game will be lost."
        actions={
          <>
            <Button variant="ghost" disabled={killing} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={killing} onClick={() => void handleKill()}>
              Kill Instance
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
  const setView = useApp((state) => state.setView);
  const showToast = useToast();

  if (overview.state !== "ready") return null;
  const { accounts, activeAccountId } = overview.value;

  if (accounts.length === 0) {
    return (
      <div className={styles.controls}>
        <p className={styles.note}>Add your Roblox account to launch this game.</p>
        <Button variant="primary" size="lg" onClick={() => setView("accounts")}>
          Add account
        </Button>
      </div>
    );
  }

  const robloxMissing = installs.state === "ready" && installs.value.length === 0;

  async function handleLaunch() {
    try {
      const warning = await launch();
      if (warning) showToast({ title: "Roblox is starting, but mods couldn't be applied", description: warning, tone: "error" });
      else showToast({ title: "Roblox is starting", tone: "ok" });
    } catch (err) {
      showToast({ title: "Couldn't launch that game", description: messageOf(err), tone: "error" });
    }
  }

  return (
    <div className={styles.controls}>
      <Select
        label="Account"
        value={activeAccountId ?? undefined}
        onChange={(id) => void setActiveAccount(id)}
        options={accounts.map((account) => ({
          value: account.id,
          label: account.displayName === account.username ? `@${account.username}` : `${account.displayName} (@${account.username})`,
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
        {launchingGame ? "Starting" : "Launch"}
      </Button>
      {robloxMissing && <p className={styles.note}>Roblox isn't installed on this PC.</p>}
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
      showToast({ title: "Couldn't update your favorites", description: messageOf(err), tone: "error" });
    }
  }

  return (
    <IconButton
      label={favorite ? "Remove from favorites" : "Add to favorites"}
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
    <section className={styles.hero} aria-label="Selected game">
      <GameArt src={game.thumbnailUrl} name={game.name} />
      <div className={styles.info}>
        <div className={styles.heading}>
          <h2 className={styles.name}>{game.name}</h2>
          <FavoriteButton game={game} />
        </div>
        {game.creatorName && <p className={styles.creator}>by {game.creatorName}</p>}
        <div className={styles.meta}>
          {game.playing !== undefined && <span>{formatPlayers(game.playing)}</span>}
          {target.jobId && <Badge>Specific server</Badge>}
        </div>
        {game.description && <p className={styles.description}>{game.description}</p>}
        {instanceActive ? <KillControls placeId={target.placeId} /> : <LaunchControls />}
      </div>
    </section>
  );
}
