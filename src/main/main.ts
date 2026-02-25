import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import { registerCompareHandlers } from "./handlers/compare-handlers";
import { registerFileHandlers } from "./handlers/file-handlers";
import { registerSessionHandlers } from "./handlers/session-handlers";
import { registerGitHandlers } from "./handlers/git-handlers";
import { registerDialogHandlers } from "./handlers/dialog-handlers";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { log, warn, error } from "../shared/logger";
import { initFileLogger, logFile, warnFile, errorFile } from "./file-logger";

let mainWindow: BrowserWindow | null = null;

// Queue file paths dropped/opened before the renderer is ready
const pendingDropPaths: string[] = [];

// macOS: files opened via "Open With" or dragged to the dock icon
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  logFile("Main", `Drag-and-drop detected: ${filePath}`);
  pendingDropPaths.push(filePath);
  if (mainWindow) {
    logFile("Main", `Sending ${pendingDropPaths.length} dropped file(s) to renderer`);
    mainWindow.webContents.send(IPC_CHANNELS.DROP_FILES, [...pendingDropPaths]);

    pendingDropPaths.length = 0;
  }
});

function createWindow(): void {
  logFile("Main", "Creating app window (1400×900)...");
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "MaCompare",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 10 },
  });
  logFile("Main", "Window created");

  // Load from Vite dev server or built files
  const isDev = !app.isPackaged;
  if (isDev) {
    logFile("Main", "Loading dev server: http://localhost:5173");
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
    logFile("Main", "DevTools opened");
  } else {
    const filePath = path.join(__dirname, "../../../renderer/index.html");
    logFile("Main", `Loading production build: ${filePath}`);
    mainWindow.loadFile(filePath);
  }

  mainWindow.on("closed", () => {
    logFile("Main", "Window closed");
    mainWindow = null;
  });

  // Flush any files queued before window was ready
  mainWindow.webContents.once("did-finish-load", () => {
    logFile("Main", "Renderer ready");
    if (pendingDropPaths.length > 0) {
      logFile("Main", `Flushing ${pendingDropPaths.length} queued drop path(s)`);
      mainWindow?.webContents.send(IPC_CHANNELS.DROP_FILES, [...pendingDropPaths]);
      pendingDropPaths.length = 0;
    }
  });

  // Handle drag-and-drop — prevent navigation only
  mainWindow.webContents.on("will-navigate", (e) => {
    logFile("Main", "Navigation blocked (drag-drop context)");
    e.preventDefault();
  });
}

app.whenReady().then(() => {
  initFileLogger();
  logFile("Main", "====== MaCompare starting ======");
  logFile("Main", `Environment: ${!app.isPackaged ? "development" : "production"}`);
  logFile("Main", "Registering IPC handlers...");

  registerCompareHandlers();
  logFile("Main", "  ✓ Compare handlers registered");
  registerFileHandlers();
  logFile("Main", "  ✓ File handlers registered");
  registerSessionHandlers();
  logFile("Main", "  ✓ Session handlers registered");
  registerGitHandlers();
  logFile("Main", "  ✓ Git handlers registered");
  registerDialogHandlers();
  logFile("Main", "  ✓ Dialog handlers registered");

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logFile("Main", "Reactivating app, reopening window");
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  logFile("Main", "All windows closed");
  if (process.platform !== "darwin") {
    logFile("Main", "Quitting app (not macOS)");
    app.quit();
  }
});

process.on("uncaughtException", (err) => {
  errorFile("Main", "Uncaught exception", err);
  process.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
