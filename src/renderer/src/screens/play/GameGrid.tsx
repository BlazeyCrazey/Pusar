import type { GameSummary } from "../../../../shared/types";
import { formatPlayers, GameArt } from "./GameArt";
import styles from "./GameGrid.module.css";

interface GameGridProps {
  games: GameSummary[];
  onPick: (game: GameSummary) => void;
}

export function GameGrid({ games, onPick }: GameGridProps) {
  return (
    <ul className={styles.grid}>
      {games.map((game) => (
        <li key={game.universeId}>
          <button type="button" className={styles.tile} onClick={() => onPick(game)}>
            <GameArt src={game.thumbnailUrl} name={game.name} />
            <span className={styles.name}>{game.name}</span>
            {game.playing !== undefined && <span className={styles.players}>{formatPlayers(game.playing)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Blank tiles matching the grid, so the layout doesn't jump when results arrive. */
export function GameGridLoading() {
  return (
    <ul className={styles.grid} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index}>
          <div className={styles.loadingArt} />
          <div className={styles.loadingLine} />
        </li>
      ))}
    </ul>
  );
}
