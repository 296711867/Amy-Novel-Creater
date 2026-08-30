import type { AmyNovelApi } from "@shared/ipc-contract";

declare global {
  interface Window {
    amyNovel?: AmyNovelApi;
  }
}

export {};
