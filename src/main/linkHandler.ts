// Optional: lets Pusar open roblox-player: links, so a website's Play button
// goes through Pusar too (PLAN.md §6). Off unless the user turns it on.
import { app, dialog } from "electron";
import { handlerRuns, pusarHandlerCommand, robloxHandlerCommand } from "../core/launchLink";
import type { LinkHandlerStatus } from "../shared/types";
import { openLaunchLink } from "./launcher";
import { log } from "./logger";
import { mods } from "./mods";
import { currentPlatform } from "./platform";

/**
 * Only an installed copy may take over the links: a registration pointing at
 * a source checkout would break website Play buttons once the checkout moves.
 */
function registry() {
  return app.isPackaged ? currentPlatform().linkHandler : undefined;
}

export async function linkHandlerStatus(): Promise<LinkHandlerStatus> {
  const handler = registry();
  if (!handler) return { supported: false, enabled: false };
  return { supported: true, enabled: handlerRuns(await handler.read(), process.execPath) };
}

export async function setLinkHandler(enabled: boolean): Promise<LinkHandlerStatus> {
  const handler = registry();
  if (!handler) throw new Error("Opening Roblox links with Pusar only works in the installed app.");

  const [install] = await currentPlatform().detectInstalls();
  if (!install) throw new Error("Install Roblox first.");

  // Turning this off points links at the newest Roblox rather than a saved
  // value, because the version that was registered earlier may be gone by then.
  await handler.write(enabled ? pusarHandlerCommand(process.execPath) : robloxHandlerCommand(install.playerPath));
  log(enabled ? "Roblox links now open with Pusar" : "Roblox links now open with Roblox");
  return linkHandlerStatus();
}

export async function handleLaunchLink(link: string): Promise<void> {
  const [install] = await currentPlatform().detectInstalls();
  if (!install) {
    dialog.showErrorBox("Roblox isn't installed", "Install Roblox, then try that link again.");
    return;
  }
  // With Roblox already open, a game may be running, and mods must not touch it.
  if (!(await currentPlatform().isPlayerRunning())) await mods().prepareLaunch(install);
  log("Passing a Roblox link through to the player");
  openLaunchLink(install, link);
}
