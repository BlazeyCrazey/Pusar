import { useEffect, useRef, useState, type RefObject } from "react";
import type { FriendsResult, FriendView, GameSummary } from "../../../shared/types";
import { call } from "../api";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { useToast } from "../components/Toast";
import { messageOf } from "../errors";
import { formatTimeAgo, t } from "../i18n";
import { useApp } from "../store";
import styles from "./LibraryScreen.module.css";
import { GameGrid, GameGridLoading } from "./play/GameGrid";

/** Friends come and go, but polling Roblox faster than this would only invite rate limits. */
const FRIENDS_REFRESH_MS = 30_000;

/** Every row is this tall, so the panel can work out how many fit. */
const FRIEND_ROW_PX = 48;

function friendStatusText(friend: FriendView): string {
  if (friend.status === "studio") return t("library.friendStudio");
  if (friend.status === "online") return t("library.friendOnline");
  if (friend.status === "offline") {
    return friend.lastSeen ? t("library.friendLastSeen", { time: formatTimeAgo(friend.lastSeen) }) : t("library.friendOffline");
  }
  return friend.gameName ? t("library.friendIn", { game: friend.gameName }) : t("library.friendInGame");
}

function FriendRow({ friend }: { friend: FriendView }) {
  const joinFriend = useApp((state) => state.joinFriend);
  const robloxBusy = useApp((state) => state.instance.status !== "idle" || state.launchingGame !== null);
  const showToast = useToast();

  async function handleJoin() {
    if (!friend.join) return;
    try {
      const warning = await joinFriend(friend.join);
      if (warning) showToast({ title: t("game.launchModsFailed"), description: warning, tone: "error" });
      else showToast({ title: t("game.launchStarted"), tone: "ok" });
    } catch (err) {
      showToast({ title: t("library.joinFailed", { name: friend.displayName }), description: messageOf(err), tone: "error" });
    }
  }

  return (
    <li className={styles.friend} data-offline={friend.status === "offline"}>
      <Avatar name={friend.displayName} src={friend.avatarUrl} size={32} />
      <div className={styles.friendText}>
        <span className={styles.friendName}>{friend.displayName}</span>
        <span className={styles.friendStatus}>{friendStatusText(friend)}</span>
      </div>
      {friend.join && (
        <Button aria-label={t("library.joinFriend", { name: friend.displayName })} disabled={robloxBusy} onClick={() => void handleJoin()}>
          {t("library.join")}
        </Button>
      )}
    </li>
  );
}

/** How many friend rows fit in the element, updated as the window is resized. */
function useRowsThatFit(ref: RefObject<HTMLElement | null>): number {
  const [rows, setRows] = useState(8);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRows(Math.max(1, Math.floor(entry.contentRect.height / FRIEND_ROW_PX)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return rows;
}

function FriendList({ friends }: { friends: FriendView[] }) {
  const area = useRef<HTMLDivElement>(null);
  const fits = useRowsThatFit(area);
  const [expanded, setExpanded] = useState(false);

  // The "…" button takes the last row that fits.
  const shown = expanded || friends.length <= fits ? friends : friends.slice(0, Math.max(fits - 1, 1));
  const hidden = friends.length - shown.length;

  return (
    <div ref={area} className={styles.friendArea} data-expanded={expanded}>
      <ul className={styles.friendList}>
        {shown.map((friend) => (
          <FriendRow key={friend.userId} friend={friend} />
        ))}
      </ul>
      {hidden > 0 && (
        <Button
          variant="ghost"
          className={styles.more}
          aria-label={t("library.showMoreFriends", { count: hidden })}
          onClick={() => setExpanded(true)}
        >
          …
        </Button>
      )}
    </div>
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

  const online = result?.friends.filter((friend) => friend.status !== "offline").length ?? 0;

  return (
    <aside className={styles.friends} aria-labelledby="friends-title">
      <h2 id="friends-title" className={styles.sectionTitle}>
        {result?.signedIn ? t("library.friendsCount", { count: online }) : t("library.friends")}
      </h2>
      {error && <p className={styles.message}>{error}</p>}
      {!result && !error && <p className={styles.message}>{t("library.friendsLoading")}</p>}
      {result && !result.signedIn && (
        <>
          <p className={styles.message}>{t("library.friendsSignedOut")}</p>
          <Button onClick={() => setView("accounts")}>{t("accounts.add")}</Button>
        </>
      )}
      {result?.signedIn && result.friends.length === 0 && !error && <p className={styles.message}>{t("library.friendsNone")}</p>}
      {result && result.friends.length > 0 && <FriendList friends={result.friends} />}
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
      showToast({ title: t("play.openFailed"), description: messageOf(err), tone: "error" });
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
        <h1 className={styles.title}>{t("library.title")}</h1>
        {library.state === "error" && <p className={styles.message}>{library.message}</p>}
        {library.state !== "error" && (
          <>
            <GameSection
              id="favorites-title"
              title={t("library.favorites")}
              games={lists?.favorites ?? null}
              empty={t("library.favoritesEmpty")}
            />
            <GameSection id="recent-title" title={t("library.recent")} games={lists?.recent ?? null} empty={t("library.recentEmpty")} />
          </>
        )}
      </div>
      {/* Starts over for each account, so one account's friends never show under another. */}
      <FriendsPanel key={activeAccountId ?? "none"} />
    </div>
  );
}
