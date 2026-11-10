// The only bridge between the UI and the main process.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC_CHANNELS, type IpcChannel, type IpcEvents, type PusarApi } from "../shared/ipc";

const allowedChannels = new Set<string>(IPC_CHANNELS);

function subscribe<E extends keyof IpcEvents>(event: E, callback: (payload: IpcEvents[E]) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: IpcEvents[E]) => callback(payload);
  ipcRenderer.on(event, listener);
  return () => ipcRenderer.off(event, listener);
}

const invoke = (channel: IpcChannel, input?: unknown) =>
  allowedChannels.has(channel)
    ? ipcRenderer.invoke(channel, input)
    : Promise.reject(new Error(`Blocked channel: ${channel}`));

const api: PusarApi = {
  isDev: process.argv.includes("--pusar-dev"),
  invoke: invoke as PusarApi["invoke"],
  onLog: (callback) => subscribe("log", callback),
  onActivity: (callback) => subscribe("activity", callback),
  onInstance: (callback) => subscribe("instance", callback),
};

contextBridge.exposeInMainWorld("pusar", api);
