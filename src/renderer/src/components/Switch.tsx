import * as RadixSwitch from "@radix-ui/react-switch";
import { useId } from "react";
import styles from "./Switch.module.css";

interface SwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, description, checked, onChange, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.text}>
        <span>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </label>
      <RadixSwitch.Root id={id} className={styles.track} checked={checked} onCheckedChange={onChange} disabled={disabled}>
        <RadixSwitch.Thumb className={styles.thumb} />
      </RadixSwitch.Root>
    </div>
  );
}
