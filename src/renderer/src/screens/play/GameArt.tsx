import { useState } from "react";
import { formatCompact, t } from "../../i18n";
import styles from "./GameArt.module.css";

function FadeInImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className={styles.image}
      data-loaded={loaded}
      src={src}
      alt=""
      draggable={false}
      referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)}
    />
  );
}

/** A game's 16:9 artwork, with a plain placeholder when Roblox has none. */
export function GameArt({ src, name }: { src?: string; name: string }) {
  return (
    <div className={styles.frame}>
      {src ? (
        // Keyed so a new game's art starts hidden instead of inheriting "loaded".
        <FadeInImage key={src} src={src} />
      ) : (
        <span className={styles.placeholder} aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}

export function formatPlayers(count: number): string {
  return t("game.playing", { players: formatCompact(count) });
}
