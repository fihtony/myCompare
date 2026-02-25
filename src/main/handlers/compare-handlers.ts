import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { runFolderCompare } from "../core/compare-engine";
import { logFile, errorFile } from "../file-logger";

export function registerCompareHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.COMPARE_FOLDER, async (_event, leftPath: string, rightPath: string, excludePatterns: string[]) => {
    try {
      logFile("Handler", `COMPARE_FOLDER IPC received: ${leftPath} vs ${rightPath}`);
      return runFolderCompare(leftPath, rightPath, excludePatterns);
    } catch (err: any) {
      errorFile("Handler", `COMPARE_FOLDER failed: ${err.message}`, err);
      throw new Error(`Folder compare failed: ${err.message}`);
    }
  });
}
