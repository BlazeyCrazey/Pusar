// The contract between the renderer and the main process. Adding a channel here
// without a matching input schema and handler is a compile error.
import type {
  AccountDiagnosis,
  ActivityUpdate,
  AddAccountResult,
  FontApplyResult,
  LaunchResult,
  ModsStatus,
  RevertResult,
  RobloxInstall,
  StoredAccount,
} from "./types";

export interface IpcChannels {
  "install:detect": { input: void; output: RobloxInstall[] };
  "mods:status": { input: { rootDir: string }; output: ModsStatus };
  "mods:applyFlags": { input: { rootDir: string; preset: string }; output: Record<string, string> };
  "mods:applyFont": { input: { rootDir: string }; output: FontApplyResult | null };
  "mods:revert": { input: { rootDir: string }; output: RevertResult };
  "accounts:list": { input: void; output: StoredAccount[] };
  "accounts:add": { input: void; output: AddAccountResult };
  "accounts:remove": { input: { id: string }; output: StoredAccount[] };
  "accounts:diagnose": { input: { id: string }; output: AccountDiagnosis };
  "launch:place": { input: { accountId: string; rootDir: string; target: string }; output: LaunchResult };
  "launch:app": { input: { rootDir: string }; output: true };
  "activity:start": {
    input: { rootDir: string; discordClientId?: string; followExistingLog?: boolean };
    output: true;
  };
  "activity:stop": { input: void; output: true };
  "log:history": { input: void; output: string[] };
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
  "accounts:list": true,
  "accounts:add": true,
  "accounts:remove": true,
  "accounts:diagnose": true,
  "launch:place": true,
  "launch:app": true,
  "activity:start": true,
  "activity:stop": true,
  "log:history": true,
  "spike:report": true,
};

export const IPC_CHANNELS = Object.keys(CHANNELS) as IpcChannel[];

/** Messages the main process pushes to the renderer. */
export interface IpcEvents {
  log: string;
  activity: ActivityUpdate;
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
}
