// The contract between the renderer and the main process. Adding a channel here
// without a matching input schema and handler is a compile error.
import type {
  AccountDiagnosis,
  AccountOverview,
  ActivityUpdate,
  AboutInfo,
  AddAccountResult,
  FontApplyResult,
  FriendsResult,
  GameSummary,
  InstanceState,
  LaunchResult,
  Library,
  LibraryGame,
  LinkHandlerStatus,
  ModsOverview,
  ModsStatus,
  Prefs,
  ResolvedGame,
  RevertResult,
  RobloxInstall,
  Settings,
  StoredAccount,
  UpdateStatus,
} from "./types";

export interface IpcChannels {
  "install:detect": { input: void; output: RobloxInstall[] };
  "mods:status": { input: { rootDir: string }; output: ModsStatus };
  "mods:applyFlags": { input: { rootDir: string; preset: string }; output: Record<string, string> };
  "mods:applyFont": { input: { rootDir: string }; output: FontApplyResult | null };
  "mods:revert": { input: { rootDir: string }; output: RevertResult };
  "mods:overview": { input: void; output: ModsOverview };
  "mods:setEnabled": { input: { enabled: boolean }; output: ModsOverview };
  "mods:addFlag": { input: { name: string }; output: ModsOverview };
  "mods:setFlag": { input: { name: string; value: string }; output: ModsOverview };
  "mods:removeFlag": { input: { name: string }; output: ModsOverview };
  "mods:setPreset": { input: { id: string; active: boolean }; output: ModsOverview };
  /** Null when the file picker is cancelled. */
  "mods:chooseFont": { input: void; output: ModsOverview | null };
  "mods:clearFont": { input: void; output: ModsOverview };
  /** Null when the file picker is cancelled. */
  "mods:importPack": { input: void; output: ModsOverview | null };
  "mods:setPackEnabled": { input: { id: string; enabled: boolean }; output: ModsOverview };
  "mods:removePack": { input: { id: string }; output: ModsOverview };
  "accounts:list": { input: void; output: StoredAccount[] };
  "accounts:overview": { input: void; output: AccountOverview };
  "accounts:setActive": { input: { id: string }; output: AccountOverview };
  "accounts:add": { input: void; output: AddAccountResult };
  "accounts:remove": { input: { id: string }; output: StoredAccount[] };
  "accounts:diagnose": { input: { id: string }; output: AccountDiagnosis };
  "games:search": { input: { query: string }; output: GameSummary[] };
  "games:popular": { input: void; output: GameSummary[] };
  "games:resolve": { input: { input: string }; output: ResolvedGame };
  "prefs:get": { input: void; output: Prefs };
  "prefs:set": { input: Partial<Settings>; output: Prefs };
  "library:get": { input: void; output: Library };
  "library:setFavorite": { input: { game: LibraryGame; favorite: boolean }; output: Library };
  "friends:list": { input: void; output: FriendsResult };
  "linkHandler:status": { input: void; output: LinkHandlerStatus };
  "linkHandler:set": { input: { enabled: boolean }; output: LinkHandlerStatus };
  "launch:place": { input: { accountId: string; rootDir: string; target: string }; output: LaunchResult };
  "launch:app": { input: { rootDir: string }; output: true };
  "instance:state": { input: void; output: InstanceState };
  "instance:kill": { input: void; output: InstanceState };
  "activity:start": {
    input: { rootDir: string; discordClientId?: string; followExistingLog?: boolean };
    output: true;
  };
  "activity:stop": { input: void; output: true };
  /** Null when no game is running. */
  "activity:current": { input: void; output: ActivityUpdate | null };
  "log:history": { input: void; output: string[] };
  "app:about": { input: void; output: AboutInfo };
  "update:status": { input: void; output: UpdateStatus };
  "update:check": { input: void; output: UpdateStatus };
  "update:install": { input: void; output: true };
  /** Copies a report with names and credentials removed to the clipboard. */
  "diagnostics:copy": { input: void; output: true };
  "spike:report": { input: void; output: string };
}

export type IpcChannel = keyof IpcChannels;
export type IpcInput<C extends IpcChannel> = IpcChannels[C]["input"];
export type IpcOutput<C extends IpcChannel> = IpcChannels[C]["output"];

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

// A Record so that a missing channel fails to compile.
const CHANNELS: Record<IpcChannel, true> = {
  "install:detect": true,
  "mods:status": true,
  "mods:applyFlags": true,
  "mods:applyFont": true,
  "mods:revert": true,
  "mods:overview": true,
  "mods:setEnabled": true,
  "mods:addFlag": true,
  "mods:setFlag": true,
  "mods:removeFlag": true,
  "mods:setPreset": true,
  "mods:chooseFont": true,
  "mods:clearFont": true,
  "mods:importPack": true,
  "mods:setPackEnabled": true,
  "mods:removePack": true,
  "accounts:list": true,
  "accounts:overview": true,
  "accounts:setActive": true,
  "accounts:add": true,
  "accounts:remove": true,
  "accounts:diagnose": true,
  "games:search": true,
  "games:popular": true,
  "games:resolve": true,
  "prefs:get": true,
  "prefs:set": true,
  "library:get": true,
  "library:setFavorite": true,
  "friends:list": true,
  "linkHandler:status": true,
  "linkHandler:set": true,
  "launch:place": true,
  "launch:app": true,
  "instance:state": true,
  "instance:kill": true,
  "activity:start": true,
  "activity:stop": true,
  "activity:current": true,
  "log:history": true,
  "app:about": true,
  "update:status": true,
  "update:check": true,
  "update:install": true,
  "diagnostics:copy": true,
  "spike:report": true,
};

export const IPC_CHANNELS = Object.keys(CHANNELS) as IpcChannel[];

/** Messages the main process pushes to the renderer. */
export interface IpcEvents {
  log: string;
  activity: ActivityUpdate;
  instance: InstanceState;
  update: UpdateStatus;
}

export interface PusarApi {
  /** True when running from source, which turns on developer-only screens. */
  readonly isDev: boolean;
  invoke<C extends IpcChannel>(
    channel: C,
    ...input: IpcInput<C> extends void ? [] : [IpcInput<C>]
  ): Promise<IpcResult<IpcOutput<C>>>;
  onLog(callback: (line: IpcEvents["log"]) => void): () => void;
  onActivity(callback: (update: IpcEvents["activity"]) => void): () => void;
  onInstance(callback: (state: IpcEvents["instance"]) => void): () => void;
  onUpdate(callback: (status: IpcEvents["update"]) => void): () => void;
}
