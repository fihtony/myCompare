import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import type { ElectronAPI } from "../shared/types";

const api: ElectronAPI = {
  compareFolder: (leftPath, rightPath, excludePatterns) =>
    ipcRenderer.invoke(IPC_CHANNELS.COMPARE_FOLDER, leftPath, rightPath, excludePatterns),
  compareFile: (leftPath, rightPath) => ipcRenderer.invoke(IPC_CHANNELS.COMPARE_FILE, leftPath, rightPath),
  compareGit: (repoPath, leftRef, rightRef) => ipcRenderer.invoke(IPC_CHANNELS.COMPARE_GIT, repoPath, leftRef, rightRef),
  sessionSaveAll: (state) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_SAVE_ALL, state),
  sessionLoadAll: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD_ALL),
  fileRead: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),
  fileReadLines: (filePath, maxLines) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_LINES, filePath, maxLines),
  fileWrite: (filePath, content) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, filePath, content),
  fileCopy: (src, dst) => ipcRenderer.invoke(IPC_CHANNELS.FILE_COPY, src, dst),
  fileDetectBinary: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DETECT_BINARY, filePath),
  fileReadHex: (filePath, offset, length) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_HEX, filePath, offset, length),
  pathStat: (p) => ipcRenderer.invoke(IPC_CHANNELS.PATH_STAT, p),
  fileStat: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FILE_STAT, filePath),
  dialogSelectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FOLDER),
  dialogSelectFile: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FILE),
  dialogSaveFile: (defaultPath) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, defaultPath),
  gitListRefs: (repoPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_LIST_REFS, repoPath),
  gitExtractFile: (repoPath, ref, filePath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_EXTRACT_FILE, repoPath, ref, filePath),
  gitMergeBase: (repoPath, ref1, ref2) => ipcRenderer.invoke(IPC_CHANNELS.GIT_MERGE_BASE, repoPath, ref1, ref2),
  gitIsRepo: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.GIT_IS_REPO, dirPath),
  onDropFiles: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.DROP_FILES, (_event, paths) => callback(paths));
  },
  closeAboutDialog: () => ipcRenderer.send("close-about-dialog"),
  notifyThemeChanged: (theme: "dark" | "light") => ipcRenderer.send("theme-changed", theme),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("electronAPI", api);
