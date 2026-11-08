import type { PusarApi } from "../src/shared/ipc";

declare global {
  interface Window {
    pusar: PusarApi;
  }
}

export {};
