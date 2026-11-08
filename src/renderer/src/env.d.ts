import type { PusarApi } from "../../shared/ipc";

declare global {
  interface Window {
    pusar: PusarApi;
  }
}

export {};
