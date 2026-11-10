import { useEffect, useState } from "react";
import type { FriendsResult, FriendView, GameSummary } from "../../../shared/types";
import { call } from "../api";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { useToast } from "../components/Toast";
import { useApp } from "../store";
import styles from "./LibraryScreen.module.css";
import { GameGrid, GameGridLoading } from "./play/GameGrid";

/** Friends come and go, but polling Roblox faster than this would only invite rate limits. */
const FRIENDS_REFRESH_MS = 30_000;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function friendStatusText(friend: FriendView): string {
  if (friend.status === "studio") return "In Roblox Studio";
  if (friend.status === "online") return "Online";
  return friend.gameName ? `In ${friend.gameName}` : "In a game";
}

function FriendRow({ friend }: { friend: FriendView }) {
  const joinFriend = useApp((state) => state.joinFriend);
  const robloxBusy = useApp((state) => state.instance.status !== "idle" || state.launchingGame !== null);
  const showToast = useToast();

  async function handleJoin() {
    if (!friend.join) return;
    try {
      const warning = await joinFriend(friend.join);
      if (warning) showToast({ title: "Roblox is starting, but mods couldn't be applied", description: warning, tone: "error" });
      else showToast({ title: "Roblox is starting", tone: "ok" });
    } catch (err) {
      showToast({ title: `Couldn't join ${friend.displayName}`, description: messageOf(err), tone: "error" });
    }
  }

  return (
    <li className={styles.friend}>
      <Avatar name={friend.displayName} src={friend.avatarUrl} size={32} />
      <div className={styles.friendText}>
        <span className={styles.friendName}>{friend.displayName}</span>
        <span className={styles.friendStatus}>{friendStatusText(friend)}</span>
      </div>
      {friend.join && (
        <Button aria-label={`Join ${friend.displayName}`} disabled={robloxBusy} onClick={() => void handleJoin()}>
          Join
        </Button>
      )}
    </li>
  );
}

function FriendsPanel() {
  const setView = useApp((state) => state.setView);
  const [result, setResult] = useState<FriendsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      // Nobody is looking while Pusar sits in the tray.
      if (document.visibilityState === "visible") {
        try {
          const next = await call("friends:list");
          if (active) {
            setResult(next);
            setError(null);
          }
        } catch (err) {
          if (active) setError(messageOf(err));
        }
      }
      if (active) timer = setTimeout(() => void load(), FRIENDS_REFRESH_MS);
    };
    void load();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <aside className={styles.friends} aria-labelledby="friends-title">
      <h2 id="friends-title" className={styles.sectionTitle}>
        Friends online
      </h2>
      {error && <p className={styles.message}>{error}</p>}
      {!result && !error && <p className={styles.message}>Loading friends</p>}
      {result && !result.signedIn && (
        <>
          <p className={styles.message}>Add a Roblox account to see who's online.</p>
          <Button onClick={() => setView("accounts")}>Add account</Button>
        </>
      )}
      {result?.signedIn && result.friends.length === 0 && !error && <p className={styles.message}>None of your friends are online.</p>}
      {result && result.friends.length > 0 && (
        <ul className={styles.friendList}>
          {result.friends.map((friend) => (
            <FriendRow key={friend.userId} friend={friend} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function GameSection({ id, title, games, empty }: { id: string; title: string; games: GameSummary[] | null; empty: string }) {
  const selectGame = useApp((state) => state.selectGame);
  const setView = useApp((state) => state.setView);
  const showToast = useToast();

  async function open(game: GameSummary) {
    try {
      await selectGame(game.placeId);
      setView("play");
    } catch (err) {
      showToast({ title: "Couldn't open that game", description: messageOf(err), tone: "error" });
    }
  }

  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      {!games && <GameGridLoading />}
      {games?.length === 0 && <p className={styles.message}>{empty}</p>}
      {games && <GameGrid games={games} onPick={(game) => void open(game)} />}
    </section>
  );
}

export function LibraryScreen() {
  const library = useApp((state) => state.library);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const activeAccountId = useApp((state) => (state.overview.state === "ready" ? state.overview.value.activeAccountId : null));

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const lists = library.state === "ready" ? library.value : null;

  return (
    <div className={styles.screen}>
      <div className={styles.games}>
        <h1 className={styles.title}>Library</h1>
        {library.state === "error" && <p className={styles.message}>{library.message}</p>}
        {library.state !== "error" && (
          <>
            <GameSection
              id="favorites-title"
              title="Favorites"
              games={lists?.favorites ?? null}
              empty="Star a game on its page and it will stay here."
            />
            <GameSection
              id="recent-title"
              title="Recently played"
              games={lists?.recent ?? null}
              empty="Games you launch from Pusar will show up here."
            />
          </>
        )}
      </div>
      {/* Starts over for each account, so one account's friends never show under another. */}
      <FriendsPanel key={activeAccountId ?? "none"} />
    </div>
  );
}
