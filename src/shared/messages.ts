/** Used to tell a lost connection apart from every other failure. */
export const ROBLOX_UNREACHABLE = "Couldn't reach Roblox. Check your connection and try again.";

/** Roblox answered, but asked Pusar to slow down. */
export const ROBLOX_BUSY = "Roblox is limiting requests right now. Try again in a few seconds.";

export const SESSION_ENDED = "Roblox ended this account's session. Remove the account and sign in again.";

/** An application ID from Discord's developer portal. Empty means none has been set. */
export const DISCORD_ID_PATTERN = /^(\d{15,25})?$/;
