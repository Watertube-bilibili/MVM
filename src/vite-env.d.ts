/// <reference types="vite/client" />

import type { MvmDesktopApi } from "./mvm-api";

export {};

declare global {
  interface Window {
    readonly mvmDesktop?: MvmDesktopApi;
  }
}
