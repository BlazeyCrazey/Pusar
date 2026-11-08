import type { IpcChannel, IpcInput, IpcOutput } from "../../shared/ipc";

/** Calls the main process. Rejects with a readable message when the call fails. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...input: IpcInput<C> extends void ? [] : [IpcInput<C>]
): Promise<IpcOutput<C>> {
  const result = await window.pusar.invoke(channel, ...input);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
