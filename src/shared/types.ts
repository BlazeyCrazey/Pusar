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

export interface AccountView extends StoredAccount {
  avatarUrl?: string;
}

export interface AccountOverview {
  accounts: AccountView[];
  /** The account used for launching. Null only when there are no accounts. */
  activeAccountId: string | null;
}

/** What happens to Pusar's window when a game starts. */
export type LaunchBehavior = "stay" | "tray" | "close";

export interface Settings {
  onLaunch: LaunchBehavior;
  discordEnabled: boolean;
  showServerRegion: boolean;
  /** Set once the first-run setup is finished or skipped. */
  onboarded: boolean;
  /** Also install beta versions, which are GitHub pre-releases. */
  betaUpdates: boolean;
}

/** unsupported: this build can't update itself, such as a run from source. */
export type UpdateStatus =
  | { state: "unsupported" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "upToDate"; checkedAt: number }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error" };

export interface AboutInfo {
  version: string;
  electron: string;
}

export interface Prefs extends Partial<Settings> {
  activeAccountId?: string;
  lastPlaceId?: string;
}

export interface GameSummary {
  universeId: string;
  placeId: string;
  name: string;
  creatorName?: string;
  playing?: number;
  /** 16:9 artwork. Missing when Roblox has none or is still moderating it. */
  thumbnailUrl?: string;
}

export interface GameDetails extends GameSummary {
  description?: string;
  visits?: number;
  maxPlayers?: number;
}

/** What's worth saving about a game. Art and player counts go stale, so they're fetched fresh. */
export type LibraryGame = Pick<GameSummary, "universeId" | "placeId" | "name" | "creatorName">;

export interface Library {
  recent: GameSummary[];
  favorites: GameSummary[];
}

export type FriendStatus = "online" | "inGame" | "studio" | "offline";

export interface FriendView {
  userId: number;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status: FriendStatus;
  /** Only when the friend's privacy settings allow it. */
  gameName?: string;
  /** Only when Roblox says this server can be joined. */
  join?: { placeId: string; jobId: string };
  /** For offline friends: when Pusar last saw them online, in ms. Roblox no longer shares this itself. */
  lastSeen?: number;
}

export interface FriendsResult {
  signedIn: boolean;
  friends: FriendView[];
}

export interface PlaceTarget {
  placeId: string;
  /** Specific server (gameInstanceId / jobId), optional. */
  jobId?: string;
}

export interface ResolvedGame {
  target: PlaceTarget;
  game: GameDetails;
}

export interface InstanceState {
  /** starting = launched and waiting to reach a game. running = in a game. */
  status: "idle" | "starting" | "running";
  placeId?: string;
}

export interface LinkHandlerStatus {
  /** False when running from source, or on an OS without this feature yet. */
  supported: boolean;
  enabled: boolean;
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
  /** Set when the game launched but mods couldn't be applied first. */
  warning?: string;
}

export type FlagStatus = "allowed" | "unknown";
export type FlagKind = "bool" | "int" | "string";

export interface ModFlagView {
  name: string;
  value: string;
  kind: FlagKind;
  description: string;
}

export interface ModPresetView {
  id: string;
  label: string;
  description: string;
  /** False until someone has seen it work in a real game. */
  confirmed: boolean;
  active: boolean;
}

export interface ModPackView {
  id: string;
  name: string;
  version: string;
  author?: string;
  fileCount: number;
  enabled: boolean;
  /** Other enabled packs replacing the same files. The later pack by name wins. */
  conflictsWith: string[];
}

export interface ModsSyncStatus {
  /** pending = saved, but waits until no game is running. */
  state: "applied" | "pending" | "noRoblox";
  versionId?: string | null;
  error?: string;
}

export interface ModsOverview {
  enabled: boolean;
  flags: ModFlagView[];
  /** Allowlisted flags not set yet, for the "add" menu. */
  availableFlags: Array<{ name: string; description: string }>;
  presets: ModPresetView[];
  /** File name of the custom font, or null. */
  font: string | null;
  packs: ModPackView[];
  sync: ModsSyncStatus;
}

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
  /** Where the server is, such as "Ashburn, US". Only when that setting is on. */
  region?: string;
}
