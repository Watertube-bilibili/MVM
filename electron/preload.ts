import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { DarlingInstallProgress, ImportProgress, MvmDesktopApi } from "./desktop-api.js";

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
  prepareDarlingInstall: "mvm:prepare-darling-install",
  installDarling: "mvm:install-darling",
  cancelDarlingInstall: "mvm:cancel-darling-install",
  runNative: "mvm:run-native",
  importAndRunNative: "mvm:import-and-run-native",
  launch: "mvm:launch",
  exportReport: "mvm:export-report",
  exportEvents: "mvm:export-events",
  revealSource: "mvm:reveal-source",
  importProgress: "mvm:import-progress",
  darlingInstallProgress: "mvm:darling-install-progress",
});

const desktopApi: MvmDesktopApi = {
  qemuStatus: async () => await ipcRenderer.invoke('mvm:qemu-status'),
  prepareQemu: async () => await ipcRenderer.invoke('mvm:qemu-prepare'),
  stopQemu: async () => await ipcRenderer.invoke('mvm:qemu-stop'),
  runQemu: async (appId) => await ipcRenderer.invoke('mvm:qemu-run',appId),
  downloadQemu: async () => await ipcRenderer.invoke('mvm:qemu-download'),
  getSnapshot: async () => await ipcRenderer.invoke(IPC.getSnapshot),
  chooseInput: async (kind) => await ipcRenderer.invoke(IPC.chooseInput, kind),
  pathForFile: (file) => webUtils.getPathForFile(file),
  importPath: async (inputPath) => await ipcRenderer.invoke(IPC.importPath, inputPath),
  createFixture: async () => await ipcRenderer.invoke(IPC.createFixture),
  removeApp: async (appId) => await ipcRenderer.invoke(IPC.removeApp, appId),
  probeRuntime: async () => await ipcRenderer.invoke(IPC.probeRuntime),
  prepareDarlingInstall: async () => await ipcRenderer.invoke(IPC.prepareDarlingInstall),
  installDarling: async (options) => await ipcRenderer.invoke(IPC.installDarling, options),
  cancelDarlingInstall: async (jobId) => await ipcRenderer.invoke(IPC.cancelDarlingInstall, jobId),
  runNative: async (appId) => await ipcRenderer.invoke(IPC.runNative, appId),
  importAndRunNative: async (inputPath) => await ipcRenderer.invoke(IPC.importAndRunNative, inputPath),
  launch: async (appId) => await ipcRenderer.invoke(IPC.launch, appId),
  exportReport: async (appId) => await ipcRenderer.invoke(IPC.exportReport, appId),
  exportEvents: async () => await ipcRenderer.invoke(IPC.exportEvents),
  revealSource: async (appId) => await ipcRenderer.invoke(IPC.revealSource, appId),
  onImportProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: ImportProgress): void => listener(progress);
    ipcRenderer.on(IPC.importProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC.importProgress, wrapped);
  },
  onDarlingInstallProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: DarlingInstallProgress): void => listener(progress);
    ipcRenderer.on(IPC.darlingInstallProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC.darlingInstallProgress, wrapped);
  },
};

contextBridge.exposeInMainWorld("mvmDesktop", Object.freeze(desktopApi));
