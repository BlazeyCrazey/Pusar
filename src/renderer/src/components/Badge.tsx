import type { ReactNode } from "react";
import styles from "./Badge.module.css";

interface BadgeProps {
  tone?: "neutral" | "ok" | "warn" | "danger";
  children: ReactNode;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  return (
    <span className={styles.badge}>
      {tone !== "neutral" && <i className={styles.dot} data-tone={tone} />}
      {children}
    </span>
  );
}
