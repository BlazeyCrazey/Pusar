import { Logo } from "./Logo";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  return (
    <header className={styles.bar}>
      <Logo />
      <span className={styles.name}>Pusar</span>
    </header>
  );
}
