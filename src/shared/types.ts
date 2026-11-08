// Data that crosses the process boundary. Types only, with no Node or Electron
// imports, so the main process and the renderer can both use them.

export type Platform = "win32" | "darwin";

export interface RobloxInstall {
  platform: Platform;
  /** Who manages this copy: Roblox itself or another bootstrapper. */
  source: string;
  /** `version-<hash>` on Windows, bundle version on macOS. */
  versionId: string | null;
  /** RobloxPlayerBeta.exe (Windows) or Roblox.app (macOS). */
  playerPath: string;
  /** Version folder (Windows) or the .app bundle (macOS). */
  rootDir: string;
  contentDir: string;
  clientSettingsFile: string;
  logsDir: string;
  /** True when roblox-player: links currently open this copy. */
  isProtocolHandler: boolean;
  /** True when content/fonts/families exists, so font mods can apply. */
  hasFontFamilies: boolean;
  modifiedAt: number;
}

export interface StoredAccount {
  id: string;
  partition: string;
  userId: number;
  username: string;
  displayName: string;
  addedAt: string;
}

export interface HbaDiagnosis {
  metadataFound: boolean;
  isAuthenticated?: boolean;
  secureAuthIntentEnabled?: boolean;
  batEnabledForAllUrls?: boolean;
  whitelistSites?: string[];
  exemptSites?: string[];
  hasKeyPair: boolean;
  error?: string;
}

export interface AddAccountResult {
  account: StoredAccount | null;
  diagnosis?: HbaDiagnosis;
  duplicate?: boolean;
}

export interface AccountDiagnosis {
  hasCookie: boolean;
  profileRequest: { status: number; signed: boolean };
  hba: HbaDiagnosis;
}

export interface LaunchResult {
  /** page = read by the page script; page-webRequest = captured by Electron; native = Node fetch with the cookie. */
  via: "page" | "page-webRequest" | "native";
  signed: boolean;
  notes: string[];
}

export type FlagStatus = "allowed" | "unknown";

export interface ModsStatus {
  flags: Array<{ name: string; value: string; status: FlagStatus }>;
  changedFiles: number;
}

export interface FontApplyResult {
  fontTarget: string;
  familiesUpdated: string[];
  familiesSkipped: string[];
}

export interface RevertResult {
  restored: number;
  removed: number;
}

export type ServerType = "public" | "private" | "reserved";

export interface ActivityState {
  status: "idle" | "joining" | "inGame";
  placeId?: string;
  universeId?: string;
  jobId?: string;
  serverIp?: string;
  serverType: ServerType;
  joinedAt?: number;
  teleporting: boolean;
  /** Server type announced before the next "joining" line. */
  pendingServerType?: ServerType;
}

export interface GameInfo {
  universeId: string;
  name: string;
  rootPlaceId?: string;
  creatorName?: string;
  iconUrl?: string;
}

/** Subset of the Discord RPC library's SetActivity that Pusar uses. */
export interface PresencePayload {
  details?: string;
  state?: string;
  startTimestamp?: number;
  largeImageKey?: string;
  largeImageText?: string;
  buttons?: Array<{ label: string; url: string }>;
}

export interface ActivityUpdate {
  state: ActivityState;
  game: GameInfo | null;
  presence: PresencePayload | null;
}
