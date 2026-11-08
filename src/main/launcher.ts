// Starts the Roblox player.
import {
  buildLaunchUri,
  buildPlaceLauncherUrl,
  generateBrowserTrackerId,
  type PlaceTarget,
} from "../core/launchUri";
import type { LaunchResult, RobloxInstall, StoredAccount } from "../shared/types";
import { clientFor } from "./accounts";
import { log } from "./logger";
import { currentPlatform } from "./platform";

function start(install: RobloxInstall, launchUri?: string): void {
  const child = currentPlatform().spawnPlayer(install, launchUri);
  child.on("error", (err) => log(`Could not start Roblox: ${err.message}`));
  child.unref();
}

/** Opens the Roblox app's home screen, with no game and no Pusar sign-in. */
export function openRobloxApp(install: RobloxInstall): void {
  start(install);
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
  start(
    install,
    buildLaunchUri({
      ticket: ticket.ticket,
      placeLauncherUrl: buildPlaceLauncherUrl(target, browserTrackerId),
      browserTrackerId,
    }),
  );
  log(`Launch: started Roblox for place ${target.placeId}${target.jobId ? ` (server ${target.jobId})` : ""}`);
  return { via: ticket.via, signed: ticket.signed, notes: ticket.notes };
}
