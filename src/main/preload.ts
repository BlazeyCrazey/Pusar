// The only bridge between the panel page and the main process.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const CHANNELS = new Set([
  "install:detect",
  "mods:status",
  "mods:applyFlags",
  "mods:applyFont",
  "mods:revert",
  "accounts:list",
  "accounts:add",
  "accounts:remove",
  "accounts:diagnose",
  "launch:place",
  "launch:app",
  "activity:start",
  "activity:stop",
  "log:history",
  "spike:report",
]);

function subscribe(channel: "log" | "activity", callback: (payload: unknown) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

contextBridge.exposeInMainWorld("pusar", {
  invoke(channel: string, payload?: unknown) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error(`Blocked channel: ${channel}`));
    return ipcRenderer.invoke(channel, payload);
  },
  onLog: (callback: (line: unknown) => void) => subscribe("log", callback),
  onActivity: (callback: (update: unknown) => void) => subscribe("activity", callback),
});
