// Runtime validation for everything the renderer sends. Never trust the types
// alone at a process boundary. A channel without a schema fails to compile.
import { z } from "zod";
import type { IpcChannel, IpcInput } from "../../shared/ipc";

const rootDir = z.string().min(1).max(1024);
const id = z.string().min(1).max(64);

export const inputSchemas: { [C in IpcChannel]: z.ZodType<IpcInput<C>> } = {
  "install:detect": z.void(),
  "mods:status": z.strictObject({ rootDir }),
  "mods:applyFlags": z.strictObject({ rootDir, preset: z.string().min(1).max(64) }),
  "mods:applyFont": z.strictObject({ rootDir }),
  "mods:revert": z.strictObject({ rootDir }),
  "accounts:list": z.void(),
  "accounts:add": z.void(),
  "accounts:remove": z.strictObject({ id }),
  "accounts:diagnose": z.strictObject({ id }),
  "launch:place": z.strictObject({ accountId: id, rootDir, target: z.string().min(1).max(2048) }),
  "launch:app": z.strictObject({ rootDir }),
  "activity:start": z.strictObject({
    rootDir,
    discordClientId: z.string().max(32).optional(),
    followExistingLog: z.boolean().optional(),
  }),
  "activity:stop": z.void(),
  "log:history": z.void(),
  "spike:report": z.void(),
};
