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
import { messageOf } from "../errors";
import { formatList, t } from "../i18n";
import styles from "./ModsScreen.module.css";

type Apply = (action: () => Promise<ModsOverview | null>) => Promise<void>;

function statusLine(overview: ModsOverview): { tone: string; text: string } {
  const { sync, enabled, flags, font, packs } = overview;
  if (sync.error) return { tone: "danger", text: sync.error };
  if (sync.state === "noRoblox") return { tone: "warn", text: t("mods.statusNoRoblox") };
  if (sync.state === "pending") return { tone: "warn", text: t("mods.statusPending") };
  if (!enabled) return { tone: "neutral", text: t("mods.statusOff") };
  if (flags.length === 0 && !font && !packs.some((pack) => pack.enabled)) return { tone: "neutral", text: t("mods.statusNone") };
  const version = sync.versionId?.replace(/^version-/, "").slice(0, 8);
  return { tone: "ok", text: version ? t("mods.statusApplied", { version }) : t("mods.statusAppliedNoVersion") };
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
            label={t("mods.flagValue", { name: flag.name })}
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
            label={t("mods.flagValue", { name: flag.name })}
            defaultValue={flag.value}
            onBlur={(event) => setValue(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        )}
      </div>
      <IconButton
        label={t("mods.remove", { name: flag.name })}
        icon={<TrashIcon />}
        onClick={() => void apply(() => call("mods:removeFlag", { name: flag.name }))}
      />
    </li>
  );
}

function PackRow({ pack, apply, onRemove }: { pack: ModPackView; apply: Apply; onRemove: () => void }) {
  const details = [
    t("mods.packVersion", { version: pack.version }),
    pack.author && t("mods.packAuthor", { author: pack.author }),
    t("mods.packFiles", { count: pack.fileCount }),
  ]
    .filter(Boolean)
    .join(" · ");
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
            <Badge tone="warn">{t("mods.packConflict", { packs: formatList(pack.conflictsWith) })}</Badge>
          </div>
        )}
      </div>
      <IconButton label={t("mods.remove", { name: pack.name })} icon={<TrashIcon />} onClick={onRemove} />
    </li>
  );
}

export function ModsScreen() {
  const [overview, setOverview] = useState<ModsOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<ModPackView | null>(null);
  const showToast = useToast();

  useEffect(() => {
    call("mods:overview").then(setOverview, (err: unknown) => setLoadError(messageOf(err)));
  }, []);

  const apply: Apply = async (action) => {
    try {
      const next = await action();
      if (next) setOverview(next);
    } catch (err) {
      showToast({ title: t("mods.changeFailed"), description: messageOf(err), tone: "error" });
    }
  };

  if (loadError || !overview) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>{t("mods.title")}</h1>
        {loadError && <p className={styles.error}>{loadError}</p>}
      </section>
    );
  }

  const status = statusLine(overview);

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("mods.title")}</h1>
        <div className={styles.master}>
          <Switch
            label={t("mods.useMods")}
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
        <h2 className={styles.sectionTitle}>{t("mods.quickTweaks")}</h2>
        <ul className={styles.list}>
          {overview.presets.map((preset) => (
            <li key={preset.id} className={styles.row}>
              <div className={styles.grow}>
                <Switch
                  label={
                    <span className={styles.presetLabel}>
                      {preset.label}
                      {!preset.confirmed && <Badge>{t("mods.untested")}</Badge>}
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
        <h2 className={styles.sectionTitle}>{t("mods.fflags")}</h2>
        <p className={styles.hint}>{t("mods.fflagsHint")}</p>
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
              label={t("mods.addFlag")}
              placeholder={t("mods.addFlag")}
              // Always empty: picking a flag adds it and the menu resets.
              value=""
              onChange={(name) => void apply(() => call("mods:addFlag", { name }))}
              options={overview.availableFlags.map((flag) => ({ value: flag.name, label: flag.name }))}
            />
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("mods.font")}</h2>
        <div className={styles.fontRow}>
          <span className={styles.grow}>{overview.font ?? t("mods.fontDefault")}</span>
          <Button onClick={() => void apply(() => call("mods:chooseFont"))}>{t("mods.chooseFont")}</Button>
          {overview.font && (
            <Button variant="ghost" onClick={() => void apply(() => call("mods:clearFont"))}>
              {t("mods.useDefaultFont")}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{t("mods.packs")}</h2>
          <Button onClick={() => void apply(() => call("mods:importPack"))}>{t("mods.importPack")}</Button>
        </div>
        {overview.packs.length === 0 ? (
          <p className={styles.hint}>{t("mods.packsEmpty")}</p>
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
        title={t("mods.removePackTitle", { name: toRemove?.name ?? t("mods.removeThisPack") })}
        description={t("mods.removePackBody")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setToRemove(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (toRemove) void apply(() => call("mods:removePack", { id: toRemove.id }));
                setToRemove(null);
              }}
            >
              {t("accounts.removeConfirm")}
            </Button>
          </>
        }
      />
    </section>
  );
}
