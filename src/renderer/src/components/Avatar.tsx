import * as RadixAvatar from "@radix-ui/react-avatar";
import styles from "./Avatar.module.css";

interface AvatarProps {
  /** Used for the fallback initial and the image's alt text. */
  name: string;
  src?: string;
  size?: number;
}

export function Avatar({ name, src, size = 32 }: AvatarProps) {
  return (
    <RadixAvatar.Root className={styles.avatar} style={{ width: size, height: size }}>
      {src && <RadixAvatar.Image className={styles.image} src={src} alt={name} />}
      <RadixAvatar.Fallback className={styles.fallback}>{name.slice(0, 1).toUpperCase()}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
