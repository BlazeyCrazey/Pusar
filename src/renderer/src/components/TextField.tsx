import { useId, type ComponentProps } from "react";
import styles from "./TextField.module.css";

interface TextFieldProps extends ComponentProps<"input"> {
  label: string;
  hint?: string;
  error?: string;
  /** For IDs, flags and other values read character by character. */
  mono?: boolean;
}

export function TextField({ label, hint, error, mono = false, className, ...rest }: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={[styles.input, mono && styles.mono].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        {...rest}
      />
      {note && (
        <p id={noteId} className={error ? styles.error : styles.hint}>
          {note}
        </p>
      )}
    </div>
  );
}
