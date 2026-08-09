import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { ImportProgress, MvmDesktopApi } from "./desktop-api.js";

// A sandboxed Electron preload may only load Electron and a small set of
// built-ins. Keep runtime channel names in this single emitted file; the type
// import above is erased by TypeScript.
const IPC = Object.freeze({
  getSnapshot: "mvm:get-snapshot",
  chooseInput: "mvm:choose-input",
  importPath: "mvm:import-path",
  createFixture: "mvm:create-fixture",
  removeApp: "mvm:remove-app",
  probeRuntime: "mvm:probe-runtime",
  launch: "mvm:launch",
  exportReport: "mvm:export-report",
  exportEvents: "mvm:export-events",
  revealSource: "mvm:reveal-source",
  importProgress: "mvm:import-progress",
});

const desktopApi: MvmDesktopApi = {
  getSnapshot: async () => await ipcRenderer.invoke(IPC.getSnapshot),
  chooseInput: async (kind) => await ipcRenderer.invoke(IPC.chooseInput, kind),
  pathForFile: (file) => webUtils.getPathForFile(file),
  importPath: async (inputPath) => await ipcRenderer.invoke(IPC.importPath, inputPath),
  createFixture: async () => await ipcRenderer.invoke(IPC.createFixture),
  removeApp: async (appId) => await ipcRenderer.invoke(IPC.removeApp, appId),
  probeRuntime: async () => await ipcRenderer.invoke(IPC.probeRuntime),
  launch: async (appId) => await ipcRenderer.invoke(IPC.launch, appId),
  exportReport: async (appId) => await ipcRenderer.invoke(IPC.exportReport, appId),
  exportEvents: async () => await ipcRenderer.invoke(IPC.exportEvents),
  revealSource: async (appId) => await ipcRenderer.invoke(IPC.revealSource, appId),
  onImportProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: ImportProgress): void => listener(progress);
    ipcRenderer.on(IPC.importProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC.importProgress, wrapped);
  },
};

contextBridge.exposeInMainWorld("mvmDesktop", Object.freeze(desktopApi));
