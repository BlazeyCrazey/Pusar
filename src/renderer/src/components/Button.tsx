import { CircleNotchIcon } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  icon?: ReactNode;
  /** Shows a spinner and blocks clicks while work is running. */
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], size === "lg" && styles.lg, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <CircleNotchIcon className={styles.spinner} size={16} /> : icon}
      {children}
    </button>
  );
}
