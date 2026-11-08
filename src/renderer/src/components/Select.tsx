import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import * as RadixSelect from "@radix-ui/react-select";
import { useId } from "react";
import styles from "./Select.module.css";

interface SelectProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
}

export function Select({ label, value, onChange, options, placeholder, disabled }: SelectProps) {
  const labelId = useId();
  return (
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
        <RadixSelect.Trigger className={styles.trigger} aria-labelledby={labelId}>
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className={styles.caret}>
            <CaretDownIcon size={14} />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item key={option.value} value={option.value} className={styles.item}>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className={styles.check}>
                    <CheckIcon size={14} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
