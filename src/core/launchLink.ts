// Rules for handling roblox-player: links when Pusar is their default app.
// Any website can trigger these links, so everything here treats them as hostile.
import { parseHandlerCommand } from "./install";

/** Only characters found in real launch links. No quotes, spaces or shell characters. */
const LAUNCH_LINK = /^roblox-player:[A-Za-z0-9+:%._~=/-]+$/;
const MAX_LENGTH = 4096;

export function isLaunchLink(value: string): boolean {
  return value.length <= MAX_LENGTH && LAUNCH_LINK.test(value);
}

export function findLaunchLink(argv: string[]): string | null {
  return argv.find(isLaunchLink) ?? null;
}

/**
 * The `--` ends Chromium's option parsing, so nothing inside a crafted link can
 * be read as a command-line switch.
 */
export function pusarHandlerCommand(executable: string): string {
  return `"${executable}" -- "%1"`;
}

/** The same form Roblox's own installer writes. */
export function robloxHandlerCommand(executable: string): string {
  return `"${executable}" %1`;
}

export function handlerRuns(command: string | null, executable: string): boolean {
  const current = parseHandlerCommand(command);
  return current !== null && current.toLowerCase() === executable.toLowerCase();
}
