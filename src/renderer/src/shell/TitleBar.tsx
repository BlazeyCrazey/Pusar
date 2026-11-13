import { t } from "../i18n";
import { Logo } from "./Logo";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  return (
    <header className={styles.bar}>
      <Logo />
      <span className={styles.name}>{t("app.name")}</span>
    </header>
  );
}
