import { ArrowLeftIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import type { GameSummary } from "../../../../shared/types";
import { call } from "../../api";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { useToast } from "../../components/Toast";
import { messageOf } from "../../errors";
import { t } from "../../i18n";
import { ROBLOX_RETRY_MS, useApp } from "../../store";
import { GameGrid, GameGridLoading } from "./GameGrid";
import { GameHero } from "./GameHero";
import styles from "./PlayScreen.module.css";

/** Long enough that pausing mid-word doesn't use up Roblox's search rate limit. */
const SEARCH_DELAY_MS = 500;

/** A long number or a roblox.com address means "open this", not "search for this". */
const isLink = (text: string) => /^\d{4,}$|roblox\.com/i.test(text);

type Results = { query: string; games: GameSummary[] } | { query: string; error: string };

export function PlayScreen() {
  const selected = useApp((state) => state.selected);
  const selectGame = useApp((state) => state.selectGame);
  const clearSelection = useApp((state) => state.clearSelection);
  const stopRestoringLastGame = useApp((state) => state.stopRestoringLastGame);
  const showToast = useToast();

  const [input, setInput] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [popular, setPopular] = useState<GameSummary[] | null>(null);
  const [popularFailed, setPopularFailed] = useState(false);

  const text = input.trim();
  const linkMode = isLink(text);
  const searchQuery = text.length >= 2 && !linkMode ? text : "";
  const showingSearch = searchQuery !== "" || linkMode;

  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout>;
    const load = () => {
      call("games:popular").then(
        (games) => {
          if (!active) return;
          setPopular(games);
          setPopularFailed(false);
        },
        () => {
          if (!active) return;
          setPopularFailed(true);
          retry = setTimeout(load, ROBLOX_RETRY_MS);
        },
      );
    };
    load();
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, []);

  useEffect(() => {
    if (!searchQuery) return;
    let current = true;
    const timer = setTimeout(() => {
      call("games:search", { query: searchQuery }).then(
        (games) => {
          if (current) setResults({ query: searchQuery, games });
        },
        (err: unknown) => {
          if (current) setResults({ query: searchQuery, error: messageOf(err) });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  async function open(target: string): Promise<boolean> {
    try {
      await selectGame(target);
      return true;
    } catch (err) {
      showToast({
        title: t("play.openFailed"),
        description: messageOf(err),
        tone: "error",
      });
      return false;
    }
  }

  async function openLink() {
    // Search text stays when picking a result, so Back returns to the results.
    // A pasted link has nothing to come back to.
    if (await open(text)) setInput("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (linkMode) void openLink();
  }

  const currentResults = results?.query === searchQuery ? results : null;

  if (selected) {
    return (
      <div className={styles.screen}>
        <h1 className="sr-only">{t("play.title")}</h1>
        <div className={styles.back}>
          <Button variant="ghost" icon={<ArrowLeftIcon size={16} />} onClick={clearSelection}>
            {t("common.back")}
          </Button>
        </div>
        <GameHero selected={selected} />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <h1 className="sr-only">{t("play.title")}</h1>

      <form className={styles.search} role="search" onSubmit={handleSubmit}>
        <MagnifyingGlassIcon className={styles.searchIcon} size={18} />
        <input
          className={styles.searchInput}
          aria-label={t("play.search")}
          placeholder={t("play.search")}
          value={input}
          spellCheck={false}
          onChange={(event) => {
            stopRestoringLastGame();
            setInput(event.target.value);
          }}
        />
        {input && (
          <div className={styles.clear}>
            <IconButton label={t("play.clearSearch")} icon={<XIcon size={16} />} onClick={() => setInput("")} />
          </div>
        )}
      </form>

      {showingSearch ? (
        <section aria-label={t("play.searchResults")}>
          {linkMode && <p className={styles.message}>{t("play.pressEnter")}</p>}
          {searchQuery && !currentResults && <GameGridLoading />}
          {currentResults && "error" in currentResults && <p className={styles.message}>{currentResults.error}</p>}
          {currentResults && "games" in currentResults && currentResults.games.length === 0 && (
            <p className={styles.message}>{t("play.noResults", { query: searchQuery })}</p>
          )}
          {currentResults && "games" in currentResults && (
            <GameGrid games={currentResults.games} onPick={(game) => void open(game.placeId)} />
          )}
        </section>
      ) : (
        <section aria-labelledby="popular-title">
          <h2 id="popular-title" className={styles.sectionTitle}>
            {t("play.topPlaying")}
          </h2>
          {popular && <GameGrid games={popular} onPick={(game) => void open(game.placeId)} />}
          {!popular && !popularFailed && <GameGridLoading />}
          {popularFailed && !popular && <p className={styles.message}>{t("play.unreachable")}</p>}
        </section>
      )}
    </div>
  );
}
