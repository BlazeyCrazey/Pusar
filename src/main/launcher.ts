// Starts the Roblox player.
import { spawn } from "node:child_process";
import type { RobloxInstall } from "../core/install";
import {
  buildLaunchUri,
  buildPlaceLauncherUrl,
  generateBrowserTrackerId,
  type PlaceTarget,
} from "../core/launchUri";
import { clientFor, type StoredAccount } from "./accounts";
import { log } from "./logger";
import type { TicketResult } from "./sessionClient";

/** With no argument, opens the Roblox app home screen (no game, no Pusar login). */
export function spawnRoblox(install: RobloxInstall, arg?: string): void {
  const child =
    install.platform === "win32"
      ? spawn(install.playerPath, arg ? [arg] : ["--app"], {
          cwd: install.rootDir,
          detached: true,
          stdio: "ignore",
        })
      : // macOS hands the URI to the app the same way clicking a link does.
        spawn("open", ["-a", install.playerPath, ...(arg ? [arg] : [])], { detached: true, stdio: "ignore" });
  child.on("error", (err) => log(`Could not start Roblox: ${err.message}`));
  child.unref();
}

export interface LaunchResult {
  via: TicketResult["via"];
  signed: boolean;
  notes: string[];
}

export async function launchPlace(
  account: StoredAccount,
  install: RobloxInstall,
  target: PlaceTarget,
): Promise<LaunchResult> {
  log(`Launch: requesting auth ticket for ${account.username}`);
  const ticket = await clientFor(account.partition).getAuthTicket();
  for (const note of ticket.notes) log(`Launch: ${note}`);
  log(`Launch: got ticket via ${ticket.via} (signed=${ticket.signed})`);

  const browserTrackerId = generateBrowserTrackerId();
  const uri = buildLaunchUri({
    ticket: ticket.ticket,
    placeLauncherUrl: buildPlaceLauncherUrl(target, browserTrackerId),
    browserTrackerId,
  });
  spawnRoblox(install, uri);
  log(`Launch: started Roblox for place ${target.placeId}${target.jobId ? ` (server ${target.jobId})` : ""}`);
  return { via: ticket.via, signed: ticket.signed, notes: ticket.notes };
}
