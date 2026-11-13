// Runtime validation for everything the renderer sends. Never trust the types
// alone at a process boundary. A channel without a schema fails to compile.
import { z } from "zod";
import { libraryGameSchema } from "../../core/library";
import type { IpcChannel, IpcInput } from "../../shared/ipc";

const rootDir = z.string().min(1).max(1024);
const id = z.string().min(1).max(64);
const flagName = z.string().min(1).max(128);

export const inputSchemas: { [C in IpcChannel]: z.ZodType<IpcInput<C>> } = {
  "install:detect": z.void(),
  "mods:status": z.strictObject({ rootDir }),
  "mods:applyFlags": z.strictObject({ rootDir, preset: z.string().min(1).max(64) }),
  "mods:applyFont": z.strictObject({ rootDir }),
  "mods:revert": z.strictObject({ rootDir }),
  "mods:overview": z.void(),
  "mods:setEnabled": z.strictObject({ enabled: z.boolean() }),
  "mods:addFlag": z.strictObject({ name: flagName }),
  "mods:setFlag": z.strictObject({ name: flagName, value: z.string().max(256) }),
  "mods:removeFlag": z.strictObject({ name: flagName }),
  "mods:setPreset": z.strictObject({ id, active: z.boolean() }),
  "mods:chooseFont": z.void(),
  "mods:clearFont": z.void(),
  "mods:importPack": z.void(),
  "mods:setPackEnabled": z.strictObject({ id, enabled: z.boolean() }),
  "mods:removePack": z.strictObject({ id }),
  "accounts:list": z.void(),
  "accounts:overview": z.void(),
  "accounts:setActive": z.strictObject({ id }),
  "accounts:add": z.void(),
  "accounts:remove": z.strictObject({ id }),
  "accounts:diagnose": z.strictObject({ id }),
  "games:search": z.strictObject({ query: z.string().min(1).max(200) }),
  "games:popular": z.void(),
  "games:resolve": z.strictObject({ input: z.string().min(1).max(2048) }),
  "prefs:get": z.void(),
  "prefs:set": z.strictObject({
    onLaunch: z.enum(["stay", "tray", "close"]).optional(),
    discordEnabled: z.boolean().optional(),
    showServerRegion: z.boolean().optional(),
    onboarded: z.boolean().optional(),
    betaUpdates: z.boolean().optional(),
  }),
  "library:get": z.void(),
  "library:setFavorite": z.strictObject({ game: libraryGameSchema, favorite: z.boolean() }),
  "friends:list": z.void(),
  "linkHandler:status": z.void(),
  "linkHandler:set": z.strictObject({ enabled: z.boolean() }),
  "launch:place": z.strictObject({ accountId: id, rootDir, target: z.string().min(1).max(2048) }),
  "launch:app": z.strictObject({ rootDir }),
  "instance:state": z.void(),
  "instance:kill": z.void(),
  "activity:start": z.strictObject({
    rootDir,
    discordClientId: z.string().max(32).optional(),
    followExistingLog: z.boolean().optional(),
  }),
  "activity:stop": z.void(),
  "activity:current": z.void(),
  "log:history": z.void(),
  "app:about": z.void(),
  "update:status": z.void(),
  "update:check": z.void(),
  "update:install": z.void(),
  "diagnostics:copy": z.void(),
  "spike:report": z.void(),
};
