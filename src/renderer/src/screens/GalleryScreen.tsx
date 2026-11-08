// Developer-only reference for every token and base component (PLAN.md §7).
import { DownloadSimpleIcon, PlayIcon, TrashIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Dialog, DialogClose } from "../components/Dialog";
import { IconButton } from "../components/IconButton";
import { Progress } from "../components/Progress";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
import { TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import styles from "./GalleryScreen.module.css";

const COLORS = [
  "bg-app",
  "bg-surface",
  "bg-raised",
  "bg-hover",
  "bg-active",
  "line",
  "line-strong",
  "text",
  "text-2",
  "text-3",
  "accent",
  "ok",
  "warn",
  "danger",
];

const TYPE_SCALE = [32, 24, 18, 15, 13, 12];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function GalleryScreen() {
  const [channel, setChannel] = useState<string | undefined>("production");
  const [closeOnLaunch, setCloseOnLaunch] = useState(true);
  const [presence, setPresence] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const showToast = useToast();

  return (
    <div className={styles.gallery}>
      <h1 className={styles.heading}>Kit</h1>

      <Section title="Color">
        <div className={styles.swatches}>
          {COLORS.map((name) => (
            <div key={name} className={styles.swatch}>
              <div className={styles.chip} style={{ background: `var(--${name})` }} />
              <code>{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className={styles.typeScale}>
          {TYPE_SCALE.map((size) => (
            <div key={size} className={styles.typeRow}>
              <code className={styles.typeSize}>{size}</code>
              <span style={{ fontSize: `var(--fs-${size})` }}>Natural Disaster Survival</span>
            </div>
          ))}
          <div className={styles.typeRow}>
            <code className={styles.typeSize}>mono</code>
            <code>FFlagDebugSkyGray = True</code>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className={styles.row}>
          <Button variant="primary" size="lg" icon={<PlayIcon weight="fill" size={18} />}>
            Launch
          </Button>
          <Button variant="primary">Apply</Button>
          <Button>Detect installs</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger" icon={<TrashIcon size={16} />}>
            Remove
          </Button>
          <Button loading>Launching</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Download" icon={<DownloadSimpleIcon />} />
        </div>
      </Section>

      <Section title="Fields">
        <div className={styles.fields}>
          <TextField label="Place ID or game link" placeholder="189707" hint="A number, or a roblox.com game link." />
          <TextField label="Discord application ID" mono defaultValue="12345" error="Application IDs are 15 to 25 digits." />
          <Select
            label="Release channel"
            value={channel}
            onChange={setChannel}
            options={[
              { value: "production", label: "Stable" },
              { value: "beta", label: "Beta" },
              { value: "nightly", label: "Nightly" },
            ]}
          />
        </div>
      </Section>

      <Section title="Switches">
        <div className={styles.switches}>
          <Switch
            label="Close Pusar when a game starts"
            description="Frees up memory while you play."
            checked={closeOnLaunch}
            onChange={setCloseOnLaunch}
          />
          <Switch label="Show my game on Discord" checked={presence} onChange={setPresence} />
        </div>
      </Section>

      <Section title="Status">
        <div className={styles.row}>
          <Badge>2 mods</Badge>
          <Badge tone="ok">Up to date</Badge>
          <Badge tone="warn">Needs reapplying</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Avatar name="Blaze" />
          <Avatar name="Pusar" size={44} />
        </div>
        <div className={styles.progress}>
          <Progress label="Downloading Roblox" value={64} />
          <Progress label="Starting Roblox" />
        </div>
      </Section>

      <Section title="Overlays">
        <div className={styles.row}>
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Button onClick={() => showToast({ title: "Roblox updated", description: "Reapplying 3 mods.", tone: "ok" })}>
            Show toast
          </Button>
        </div>
      </Section>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Remove this account?"
        description="You'll be signed out of Roblox on this device."
        actions={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button variant="danger">Remove</Button>
            </DialogClose>
          </>
        }
      />
    </div>
  );
}
