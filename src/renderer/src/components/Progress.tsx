import styles from "./Progress.module.css";

interface ProgressProps {
  label: string;
  /** 0 to 100. Leave out when the duration is unknown. */
  value?: number;
}

export function Progress({ label, value }: ProgressProps) {
  const indeterminate = value === undefined;
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div
        className={indeterminate ? styles.sliding : styles.fill}
        style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
