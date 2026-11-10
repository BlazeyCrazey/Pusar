import {
  GearSixIcon,
  PlayIcon,
  PuzzlePieceIcon,
  SquaresFourIcon,
  SwatchesIcon,
  UsersIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useApp, type ViewId } from "../store";
import styles from "./NavRail.module.css";

interface NavItem {
  id: ViewId;
  label: string;
  icon: Icon;
}

const MAIN_ITEMS: NavItem[] = [
  { id: "play", label: "Play", icon: PlayIcon },
  { id: "library", label: "Library", icon: SquaresFourIcon },
  { id: "mods", label: "Mods", icon: PuzzlePieceIcon },
  { id: "accounts", label: "Accounts", icon: UsersIcon },
];

const SETTINGS_ITEM: NavItem = { id: "settings", label: "Settings", icon: GearSixIcon };
const GALLERY_ITEM: NavItem = { id: "gallery", label: "Kit", icon: SwatchesIcon };

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
      <span>{label}</span>
    </button>
  );

  return (
    <nav className={styles.rail} aria-label="Main">
      <div className={styles.group}>{MAIN_ITEMS.map(renderItem)}</div>
      <div className={styles.group}>
        {window.pusar.isDev && renderItem(GALLERY_ITEM)}
        {renderItem(SETTINGS_ITEM)}
      </div>
    </nav>
  );
}
