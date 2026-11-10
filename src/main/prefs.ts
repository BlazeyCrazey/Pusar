// Small settings that should survive a restart.
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DISCORD_ID_PATTERN } from "../shared/messages";
import type { Prefs } from "../shared/types";

// Each field falls back on its own, so one bad value can't reset everything else.
const prefsSchema = z.object({
  activeAccountId: z.string().optional().catch(undefined),
  lastPlaceId: z.string().regex(/^\d{1,20}$/).optional().catch(undefined),
  onLaunch: z.enum(["stay", "tray", "close"]).optional().catch(undefined),
  discordEnabled: z.boolean().optional().catch(undefined),
  discordClientId: z.string().regex(DISCORD_ID_PATTERN).optional().catch(undefined),
  showServerRegion: z.boolean().optional().catch(undefined),
});

const prefsPath = () => path.join(app.getPath("userData"), "prefs.json");

export function readPrefs(): Prefs {
  try {
    return prefsSchema.parse(JSON.parse(readFileSync(prefsPath(), "utf8")));
  } catch {
    // Missing or damaged: start from defaults.
    return {};
  }
}

export function updatePrefs(changes: Prefs): Prefs {
  const next = { ...readPrefs(), ...changes };
  writeFileSync(prefsPath(), JSON.stringify(next, null, 2));
  return next;
}
