import { app, BrowserWindow, ipcMain, dialog, Menu, MenuItemConstructorOptions } from "electron";
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
let currentTheme: "dark" | "light" = "dark";

// Queue file paths dropped/opened before the renderer is ready
const pendingDropPaths: string[] = [];

function showAboutDialog(theme: "dark" | "light" = currentTheme): void {
  const isDark = theme === "dark";
  logFile("Main", `Showing About Dialog with theme: ${theme} (isDark=${isDark})`);
  const aboutHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="color-scheme" content="light dark">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        :root {
          color-scheme: light dark;
        }
        
        /* Base body styles */
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          overflow: hidden;
          padding: 0;
          ${
            isDark
              ? `
            background-color: #1e1e1e;
            color: #ffffff;
          `
              : `
            background-color: #ffffff;
            color: #000000;
          `
          }
        }
        
        .header {
          position: absolute;
          top: 0;
          right: 0;
          width: 100%;
          height: 40px;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          padding-right: 12px;
          padding-top: 8px;
          border-bottom: 1px solid ${isDark ? "#404040" : "#e5e5e5"};
        }
        
        .close-btn {
          background: none;
          border: none;
          font-size: 16px;
          cursor: pointer;
          color: ${isDark ? "#666666" : "#999999"};
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 3px;
          transition: all 0.15s ease;
          padding: 0;
          line-height: 1;
        }
        
        .close-btn:hover {
          background-color: ${isDark ? "#333333" : "#f0f0f0"};
          color: ${isDark ? "#cccccc" : "#333333"};
        }
        
        .close-btn:active {
          background-color: ${isDark ? "#404040" : "#e0e0e0"};
        }
        
        .container {
          text-align: center;
          padding: 60px 30px 60px 30px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
        }
        
        .title {
          font-size: 20px;
          font-weight: 600;
          margin-bottom: 12px;
          color: ${isDark ? "#ffffff" : "#000000"};
        }
        
        .description {
          font-size: 12px;
          color: ${isDark ? "#d4d4d4" : "#666666"};
          margin-bottom: 16px;
          line-height: 1.5;
          max-width: 320px;
        }
        
        .version {
          font-size: 11px;
          color: ${isDark ? "#d4d4d4" : "#666666"};
          margin-bottom: 16px;
        }
        
        .divider {
          width: 100%;
          height: 1px;
          background-color: ${isDark ? "#404040" : "#e0e0e0"};
          margin: 12px 0;
        }
        
        .owner-section {
          font-size: 11px;
          color: ${isDark ? "#d4d4d4" : "#666666"};
          margin-bottom: 12px;
          line-height: 1.6;
        }
        
        .copyright {
          font-size: 10px;
          color: ${isDark ? "#888888" : "#999999"};
          margin-bottom: 0;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <button class="close-btn" id="closeBtn" title="Close">✕</button>
      </div>
      <div class="container">
        <div class="title">myCompare</div>
        <div class="description">
          A modern file, folder, and Git<br>comparison tool for macOS.
        </div>
        <div class="version">Version 1.0.0</div>
        <div class="divider"></div>
        <div class="owner-section">
          Designer: Tony Xu<br>
          tony@tarch.ca
        </div>
        <div class="copyright">
          © 2026 Tony Xu. All rights reserved.
        </div>
      </div>
      <script>
        // Close button handler
        document.getElementById('closeBtn').addEventListener('click', () => {
          if (window.electronAPI && typeof window.electronAPI.closeAboutDialog === 'function') {
            window.electronAPI.closeAboutDialog();
          } else {
            // Fallback: use Escape key simulation through native Electron mechanism
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('close-about-dialog');
          }
        });
        
        // Also allow Escape key to close (handled by before-input-event)
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            if (window.electronAPI && typeof window.electronAPI.closeAboutDialog === 'function') {
              window.electronAPI.closeAboutDialog();
            }
          }
        });
      </script>
    </body>
    </html>
  `;

  const aboutWindow = new BrowserWindow({
    width: 380,
    height: 310,
    resizable: false,
    modal: true,
    parent: mainWindow || undefined,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(aboutHTML)}`);
  aboutWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key.toLowerCase() === "enter" || input.key === "Escape") {
      event.preventDefault();
      aboutWindow.close();
    }
  });
}

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

function createMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: "myCompare",
      submenu: [
        {
          label: "About myCompare",
          click: () => {
            showAboutDialog(currentTheme);
          },
        },
        { type: "separator" as const },
        {
          label: "Quit",
          accelerator: "Cmd+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      // Edit menu is REQUIRED on macOS so that Cmd+C / Cmd+V / Cmd+Z etc.
      // are routed through the app menu and dispatched to the renderer process.
      // Without this, clipboard shortcuts are silently swallowed by macOS.
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" as const },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
  ];
}

function createWindow(): void {
  logFile("Main", "Creating app window (1400×900)...");

  // Resolve icon path for both dev and production
  // __dirname is dist-electron/main, so go up 2 levels to project root
  const projectRoot = path.resolve(__dirname, "../../");
  const fs = require("fs");

  let iconPath: string | undefined;
  if (process.platform === "darwin") {
    const icnsPath = path.join(projectRoot, "assets", "icon.icns");
    const pngPath = path.join(projectRoot, "assets", "icon.png");
    iconPath = fs.existsSync(icnsPath) ? icnsPath : fs.existsSync(pngPath) ? pngPath : undefined;
  } else {
    iconPath = path.join(projectRoot, "assets", "icon.png");
  }

  if (iconPath && fs.existsSync(iconPath)) {
    logFile("Main", `Loading icon: ${iconPath}`);
  } else {
    logFile("Main", `Warning: Icon not found at expected paths`);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "myCompare",
    icon: iconPath || undefined,
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
    const filePath = path.join(__dirname, "../../dist/index.html");
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
  logFile("Main", "====== myCompare starting ======");
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

  // Handle About dialog close
  ipcMain.on("close-about-dialog", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.close();
    }
  });

  // Handle theme update from renderer
  ipcMain.on("theme-changed", (event, theme: "dark" | "light") => {
    logFile("Main", `Theme changed IPC received: ${theme}`);
    currentTheme = theme;
    logFile("Main", `Current theme updated to: ${currentTheme}`);
  });

  createWindow();
  Menu.setApplicationMenu(Menu.buildFromTemplate(createMenuTemplate()));

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
