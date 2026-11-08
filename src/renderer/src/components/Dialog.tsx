import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import styles from "./Dialog.module.css";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Buttons, right-aligned at the bottom. */
  actions: ReactNode;
  children?: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, actions, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.content} aria-describedby={description ? undefined : ""}>
          <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
          {description && <RadixDialog.Description className={styles.description}>{description}</RadixDialog.Description>}
          {children}
          <div className={styles.actions}>{actions}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
