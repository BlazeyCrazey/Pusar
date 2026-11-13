import {
  GearSixIcon,
  PlayIcon,
  PuzzlePieceIcon,
  SquaresFourIcon,
  SwatchesIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react";
import { t, type MessageKey } from "../i18n";
import { useApp, type ViewId } from "../store";
import styles from "./NavRail.module.css";

interface NavItem {
  id: ViewId;
  label: MessageKey;
  icon: Icon;
}

const MAIN_ITEMS: NavItem[] = [
  { id: "play", label: "nav.play", icon: PlayIcon },
  { id: "library", label: "nav.library", icon: SquaresFourIcon },
  { id: "mods", label: "nav.mods", icon: PuzzlePieceIcon },
  { id: "accounts", label: "nav.accounts", icon: UsersIcon },
];

const SETTINGS_ITEM: NavItem = { id: "settings", label: "nav.settings", icon: GearSixIcon };
const GALLERY_ITEM: NavItem = { id: "gallery", label: "nav.kit", icon: SwatchesIcon };

export function NavRail() {
  const active = useApp((state) => state.view);
  const setView = useApp((state) => state.setView);

  const renderItem = ({ id, label, icon: ItemIcon }: NavItem) => (
    <button
      key={id}
      type="button"
      className={styles.item}
      aria-current={active === id ? "page" : undefined}
      onClick={() => setView(id)}
    >
      <ItemIcon size={22} />
      <span>{t(label)}</span>
    </button>
  );

  return (
    <nav className={styles.rail} aria-label={t("nav.label")}>
      <div className={styles.group}>{MAIN_ITEMS.map(renderItem)}</div>
      <div className={styles.group}>
        {window.pusar.isDev && renderItem(GALLERY_ITEM)}
        {renderItem(SETTINGS_ITEM)}
      </div>
    </nav>
  );
}
