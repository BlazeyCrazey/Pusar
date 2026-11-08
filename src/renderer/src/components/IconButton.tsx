import type { ComponentProps, ReactNode } from "react";
import styles from "./IconButton.module.css";
import { Tooltip } from "./Tooltip";

interface IconButtonProps extends Omit<ComponentProps<"button">, "children"> {
  /** Required: it's both the accessible name and the tooltip. */
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, className, ...rest }: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <button type="button" aria-label={label} className={[styles.button, className].filter(Boolean).join(" ")} {...rest}>
        {icon}
      </button>
    </Tooltip>
  );
}
