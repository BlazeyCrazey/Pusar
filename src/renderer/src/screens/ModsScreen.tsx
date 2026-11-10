import { TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ModFlagView, ModPackView, ModsOverview } from "../../../shared/types";
import { call } from "../api";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { IconButton } from "../components/IconButton";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
import { TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import styles from "./ModsScreen.module.css";

type Apply = (action: () => Promise<ModsOverview | null>) => Promise<void>;

function statusLine(overview: ModsOverview): { tone: string; text: string } {
  const { sync, enabled, flags, font, packs } = overview;
  if (sync.error) return { tone: "danger", text: sync.error };
  if (sync.state === "noRoblox") return { tone: "warn", text: "Roblox isn't installed" };
  if (sync.state === "pending") return { tone: "warn", text: "Saved. Applies the next time you launch." };
  if (!enabled) return { tone: "neutral", text: "Off. Roblox is using its original files." };
  if (flags.length === 0 && !font && !packs.some((pack) => pack.enabled)) return { tone: "neutral", text: "No mods active" };
  const version = sync.versionId?.replace(/^version-/, "").slice(0, 8) ?? "";
  return { tone: "ok", text: `Applied to Roblox ${version}`.trim() };
}

function FlagRow({ flag, apply }: { flag: ModFlagView; apply: Apply }) {
  const setValue = (value: string) => {
    if (value !== flag.value) void apply(() => call("mods:setFlag", { name: flag.name, value }));
  };

  return (
    <li className={styles.row}>
      <div className={styles.grow}>
        <code className={styles.flagName}>{flag.name}</code>
        {flag.description && <span className={styles.sub}>{flag.description}</span>}
      </div>
      <div className={styles.flagValue}>
        {flag.kind === "bool" ? (
          <Select
            hideLabel
            label={`Value of ${flag.name}`}
            value={flag.value}
            onChange={setValue}
            options={[
              { value: "True", label: "True" },
              { value: "False", label: "False" },
            ]}
          />
        ) : (
          <TextField
            // Keyed so a rejected edit snaps back to the saved value.
            key={flag.value}
            hideLabel
            mono
            label={`Value of ${flag.name}`}
            defaultValue={flag.value}
            onBlur={(event) => setValue(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        )}
      </div>
      <IconButton
        label={`Remove ${flag.name}`}
        icon={<TrashIcon />}
        onClick={() => void apply(() => call("mods:removeFlag", { name: flag.name }))}
      />
    </li>
  );
}

function PackRow({ pack, apply, onRemove }: { pack: ModPackView; apply: Apply; onRemove: () => void }) {
  const details = [`v${pack.version}`, pack.author && `by ${pack.author}`, `${pack.fileCount} files`].filter(Boolean).join(" · ");
  return (
    <li className={styles.row}>
      <div className={styles.grow}>
        <Switch
          label={pack.name}
          description={details}
          checked={pack.enabled}
          onChange={(enabled) => void apply(() => call("mods:setPackEnabled", { id: pack.id, enabled }))}
        />
        {pack.conflictsWith.length > 0 && (
          <div className={styles.conflict}>
            <Badge tone="warn">{`Replaces the same files as ${pack.conflictsWith.join(", ")}`}</Badge>
          </div>
        )}
      </div>
      <IconButton label={`Remove ${pack.name}`} icon={<TrashIcon />} onClick={onRemove} />
    </li>
  );
}

export function ModsScreen() {
  const [overview, setOverview] = useState<ModsOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<ModPackView | null>(null);
  const showToast = useToast();

  useEffect(() => {
    call("mods:overview").then(setOverview, (err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  const apply: Apply = async (action) => {
    try {
      const next = await action();
      if (next) setOverview(next);
    } catch (err) {
      showToast({
        title: "Couldn't change that",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    }
  };

  if (loadError) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Mods</h1>
        <p className={styles.error}>{loadError}</p>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Mods</h1>
      </section>
    );
  }

  const status = statusLine(overview);

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Mods</h1>
        <div className={styles.master}>
          <Switch
            label="Use mods"
            checked={overview.enabled}
            onChange={(enabled) => void apply(() => call("mods:setEnabled", { enabled }))}
          />
        </div>
      </header>
      <p className={styles.status} role="status">
        <i className={styles.dot} data-tone={status.tone} />
        {status.text}
      </p>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Quick tweaks</h2>
        <ul className={styles.list}>
          {overview.presets.map((preset) => (
            <li key={preset.id} className={styles.row}>
              <div className={styles.grow}>
                <Switch
                  label={
                    <span className={styles.presetLabel}>
                      {preset.label}
                      {!preset.confirmed && <Badge>Untested</Badge>}
                    </span>
                  }
                  description={preset.description}
                  checked={preset.active}
                  onChange={(active) => void apply(() => call("mods:setPreset", { id: preset.id, active }))}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>FFlags</h2>
        <p className={styles.hint}>Roblox only reads these when it starts. Pusar restarts Roblox's background process for you at launch.</p>
        {overview.flags.length > 0 && (
          <ul className={styles.list}>
            {overview.flags.map((flag) => (
              <FlagRow key={flag.name} flag={flag} apply={apply} />
            ))}
          </ul>
        )}
        {overview.availableFlags.length > 0 && (
          <div className={styles.addFlag}>
            <Select
              hideLabel
              label="Add an FFlag"
              placeholder="Add an FFlag"
              // Always empty: picking a flag adds it and the menu resets.
              value=""
              onChange={(name) => void apply(() => call("mods:addFlag", { name }))}
              options={overview.availableFlags.map((flag) => ({ value: flag.name, label: flag.name }))}
            />
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Font</h2>
        <div className={styles.fontRow}>
          <span className={styles.grow}>{overview.font ?? "Roblox's default fonts"}</span>
          <Button onClick={() => void apply(() => call("mods:chooseFont"))}>Choose font</Button>
          {overview.font && (
            <Button variant="ghost" onClick={() => void apply(() => call("mods:clearFont"))}>
              Use default
            </Button>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Mod packs</h2>
          <Button onClick={() => void apply(() => call("mods:importPack"))}>Import pack</Button>
        </div>
        {overview.packs.length === 0 ? (
          <p className={styles.hint}>Packs swap Roblox's images, fonts and sounds. Only import packs from people you trust.</p>
        ) : (
          <ul className={styles.list}>
            {overview.packs.map((pack) => (
              <PackRow key={pack.id} pack={pack} apply={apply} onRemove={() => setToRemove(pack)} />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open) setToRemove(null);
        }}
        title={`Remove ${toRemove?.name ?? "this pack"}?`}
        description="Roblox goes back to its original files for this pack. You'd need the original file to import it again."
        actions={
          <>
            <Button variant="ghost" onClick={() => setToRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (toRemove) void apply(() => call("mods:removePack", { id: toRemove.id }));
                setToRemove(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </section>
  );
}
