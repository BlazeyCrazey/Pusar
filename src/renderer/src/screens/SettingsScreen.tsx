import { useEffect, useState } from "react";
import { DISCORD_ID_PATTERN } from "../../../shared/messages";
import type { LaunchBehavior, LinkHandlerStatus, Prefs, Settings } from "../../../shared/types";
import { call } from "../api";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
import { TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import styles from "./SettingsScreen.module.css";

const LAUNCH_OPTIONS: Array<{ value: LaunchBehavior; label: string }> = [
  { value: "stay", label: "Keep Pusar open" },
  { value: "tray", label: "Hide Pusar in the tray" },
  { value: "close", label: "Close Pusar" },
];

const LAUNCH_NOTES: Record<LaunchBehavior, string> = {
  stay: "Pusar stays where it is while you play.",
  tray: "Pusar comes back by itself when you leave the game.",
  close: "Your Discord status ends with Pusar. Start Pusar again to manage a running game.",
};

export function SettingsScreen() {
  const [status, setStatus] = useState<LinkHandlerStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [discordId, setDiscordId] = useState("");
  const showToast = useToast();

  function showError(err: unknown) {
    showToast({
      title: "Couldn't change that setting",
      description: err instanceof Error ? err.message : String(err),
      tone: "error",
    });
  }

  useEffect(() => {
    call("linkHandler:status").then(setStatus, () => setStatus({ supported: false, enabled: false }));
    call("prefs:get").then(
      (loaded) => {
        setPrefs(loaded);
        setDiscordId(loaded.discordClientId ?? "");
      },
      () => setPrefs({}),
    );
  }, []);

  async function handleLinkToggle(enabled: boolean) {
    setSaving(true);
    try {
      setStatus(await call("linkHandler:set", { enabled }));
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function save(changes: Partial<Settings>) {
    try {
      setPrefs(await call("prefs:set", changes));
    } catch (err) {
      showError(err);
    }
  }

  const discordIdValid = DISCORD_ID_PATTERN.test(discordId);
  const onLaunch = prefs?.onLaunch ?? "stay";

  function handleDiscordId(value: string) {
    const id = value.trim();
    setDiscordId(id);
    if (DISCORD_ID_PATTERN.test(id)) void save({ discordClientId: id });
  }

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>Settings</h1>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Launching</h2>
        <Select
          label="When a game starts"
          value={onLaunch}
          disabled={!prefs}
          onChange={(value) => void save({ onLaunch: value as LaunchBehavior })}
          options={LAUNCH_OPTIONS}
        />
        <p className={styles.note}>{LAUNCH_NOTES[onLaunch]}</p>
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>While you play</h2>
        <Switch
          label="Show your game on Discord"
          description="Your Discord profile shows the game you're in, with a link to it. Needs the Discord app running."
          checked={prefs?.discordEnabled ?? false}
          disabled={!prefs}
          onChange={(discordEnabled) => void save({ discordEnabled })}
        />
        {prefs?.discordEnabled && (
          <TextField
            label="Discord application ID"
            className={styles.field}
            mono
            spellCheck={false}
            value={discordId}
            onChange={(event) => handleDiscordId(event.target.value)}
            hint="From discord.com/developers. Discord shows that application's name above your game."
            error={discordIdValid ? undefined : "An application ID is 15 to 25 digits."}
          />
        )}
        <div className={styles.spaced}>
          <Switch
            label="Show where the server is"
            description="Sends the server's address to ipinfo.io when you join, so Pusar can show a city and country."
            checked={prefs?.showServerRegion ?? false}
            disabled={!prefs}
            onChange={(showServerRegion) => void save({ showServerRegion })}
          />
        </div>
      </div>

      <div className={styles.group}>
        <h2 className={styles.groupTitle}>Roblox links</h2>
        <Switch
          label="Open Roblox links with Pusar"
          description="Play buttons on roblox.com will go through Pusar. Turn this off to give them back to Roblox."
          checked={status?.enabled ?? false}
          disabled={!status?.supported || saving}
          onChange={(enabled) => void handleLinkToggle(enabled)}
        />
        {status && !status.supported && <p className={styles.note}>Only available in the installed app.</p>}
      </div>
    </section>
  );
}
