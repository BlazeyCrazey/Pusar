import * as RadixToast from "@radix-ui/react-toast";
import { createContext, use, useCallback, useRef, useState, type ReactNode } from "react";
import styles from "./Toast.module.css";

type Tone = "neutral" | "ok" | "error";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

type ShowToast = (toast: Omit<ToastItem, "id" | "tone"> & { tone?: Tone }) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return use(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ShowToast>((toast) => {
    setItems((current) => [...current, { tone: "neutral", ...toast, id: nextId.current++ }]);
  }, []);

  const dismiss = (id: number) => setItems((current) => current.filter((item) => item.id !== id));

  return (
    <ToastContext value={show}>
      <RadixToast.Provider duration={5000}>
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            className={styles.toast}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
          >
            <i className={styles.dot} data-tone={item.tone} />
            <div>
              <RadixToast.Title className={styles.title}>{item.title}</RadixToast.Title>
              {item.description && (
                <RadixToast.Description className={styles.description}>{item.description}</RadixToast.Description>
              )}
            </div>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className={styles.viewport} />
      </RadixToast.Provider>
    </ToastContext>
  );
}
