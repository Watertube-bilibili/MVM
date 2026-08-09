import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";

import { IPC, type ImportProgress } from "./desktop-api.js";
import { MvmService } from "./mvm-service.js";

const DEVELOPMENT_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;
let service: MvmService;

function isTrustedDevelopmentUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function resourcesRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(app.getAppPath(), "resources");
}

function requireMainWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const frameUrl = event.senderFrame?.url;
  let trustedFrame = false;
  try {
    if (frameUrl) {
      const url = new URL(frameUrl);
      trustedFrame = DEVELOPMENT_SERVER_URL
        ? url.origin === new URL(DEVELOPMENT_SERVER_URL).origin
        : url.protocol === "file:" && path.resolve(fileURLToPath(url)) === path.resolve(__dirname, "..", "dist", "index.html");
    }
  } catch {
    trustedFrame = false;
  }
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !trustedFrame
  ) {
    throw new Error("IPC request did not originate from the MVM main window.");
  }
  return mainWindow;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 32_000 || value.includes("\0")) {
    throw new TypeError(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.getSnapshot, (event) => {
    requireMainWindow(event);
    return service.snapshot();
  });

  ipcMain.handle(IPC.chooseInput, async (event, requestedKind: unknown) => {
    const window = requireMainWindow(event);
    if (requestedKind !== "package" && requestedKind !== "app-folder") {
      throw new TypeError("Unknown input picker kind.");
    }
    const result = await dialog.showOpenDialog(window, requestedKind === "package"
      ? {
          title: "导入 Mac 应用包",
          buttonLabel: "安全检查",
          properties: ["openFile"],
          filters: [
            { name: "Mac 应用包", extensions: ["dmg", "pkg", "zip"] },
            { name: "所有文件", extensions: ["*"] },
          ],
        }
      : {
          title: "选择 .app 文件夹",
          buttonLabel: "分析应用",
          properties: ["openDirectory"],
        });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC.importPath, async (event, inputPath: unknown) => {
    requireMainWindow(event);
    return await service.importPath(requireString(inputPath, "inputPath"));
  });

  ipcMain.handle(IPC.createFixture, async (event) => {
    requireMainWindow(event);
    return await service.createFixture();
  });

  ipcMain.handle(IPC.removeApp, async (event, appId: unknown) => {
    requireMainWindow(event);
    return await service.removeApp(requireString(appId, "appId"));
  });

  ipcMain.handle(IPC.probeRuntime, async (event) => {
    requireMainWindow(event);
    return await service.probeRuntime();
  });

  ipcMain.handle(IPC.launch, async (event, appId: unknown) => {
    requireMainWindow(event);
    return await service.launch(requireString(appId, "appId"));
  });

  ipcMain.handle(IPC.exportReport, async (event, appIdValue: unknown) => {
    const window = requireMainWindow(event);
    const appId = requireString(appIdValue, "appId");
    const report = service.reportJson(appId);
    if (!report) return false;
    const result = await dialog.showSaveDialog(window, {
      title: "导出兼容性报告",
      defaultPath: path.join(app.getPath("downloads"), service.suggestedReportName(appId)),
      filters: [{ name: "JSON 报告", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, report, "utf8");
    return true;
  });

  ipcMain.handle(IPC.exportEvents, async (event) => {
    const window = requireMainWindow(event);
    const result = await dialog.showSaveDialog(window, {
      title: "导出 MVM 事件",
      defaultPath: path.join(app.getPath("downloads"), "MVM-events.json"),
      filters: [{ name: "JSON 事件", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, service.eventsJson(), "utf8");
    return true;
  });

  ipcMain.handle(IPC.revealSource, async (event, appIdValue: unknown) => {
    requireMainWindow(event);
    const sourcePath = service.sourcePath(requireString(appIdValue, "appId"));
    if (!sourcePath || !path.isAbsolute(sourcePath)) return false;
    shell.showItemInFolder(sourcePath);
    return true;
  });
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "MVM",
    icon: path.join(resourcesRoot(), "icon.ico"),
    backgroundColor: "#e8eef0",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  if (DEVELOPMENT_SERVER_URL) {
    if (!isTrustedDevelopmentUrl(DEVELOPMENT_SERVER_URL)) {
      throw new Error("VITE_DEV_SERVER_URL must point to localhost over HTTP.");
    }
    await window.loadURL(DEVELOPMENT_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    service = new MvmService(app.getPath("userData"), resourcesRoot());
    await service.initialize();
    registerIpcHandlers();
    service.setProgressEmitter((progress: ImportProgress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.importProgress, progress);
      }
    });
    await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    });
  }).catch((error: unknown) => {
    dialog.showErrorBox("MVM 无法启动", error instanceof Error ? error.message : "未知启动错误");
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
