import { Badge } from "../components/Badge";
import type { ViewId } from "../shell/NavRail";
import styles from "./PlannedScreen.module.css";

const PLANNED: Record<Exclude<ViewId, "gallery">, { title: string; body: string; milestone: string }> = {
  play: { title: "Play", body: "Pick a game and an account, then launch straight in.", milestone: "M2" },
  library: { title: "Library", body: "Favorites, recently played, and friends you can join.", milestone: "M4" },
  mods: { title: "Mods", body: "FFlags, fonts, cursors and sounds, with one-click revert.", milestone: "M3" },
  accounts: { title: "Accounts", body: "Add, switch and remove your Roblox accounts.", milestone: "M2" },
  settings: { title: "Settings", body: "Launch behavior, Discord presence and updates.", milestone: "M4" },
};

/** Stands in for a screen until its milestone builds it. */
export function PlannedScreen({ view }: { view: Exclude<ViewId, "gallery"> }) {
  const { title, body, milestone } = PLANNED[view];
  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.body}>{body}</p>
      <div className={styles.note}>
        <Badge>{`Planned for ${milestone}`}</Badge>
        {window.pusar.isDev && (
          <span>
            Working test tools: <code>npm run spike</code>
          </span>
        )}
      </div>
    </section>
  );
}
