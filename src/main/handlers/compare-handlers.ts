import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { runFolderCompareStreaming } from "../core/compare-engine";
import { logFile, errorFile } from "../file-logger";

export function registerCompareHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.COMPARE_FOLDER, async (event, leftPath: string, rightPath: string, excludePatterns: string[]) => {
    try {
      logFile("Handler", `COMPARE_FOLDER IPC received: ${leftPath} vs ${rightPath}`);
      let lastSent = 0;
      const result = await runFolderCompareStreaming(leftPath, rightPath, excludePatterns, (processed: number) => {
        // Throttle progress events to avoid flooding the renderer
        if (processed - lastSent >= 25) {
          lastSent = processed;
          event.sender.send(IPC_CHANNELS.FOLDER_COMPARE_PROGRESS, { processed, done: false });
        }
      });
      // Send final completion event
      event.sender.send(IPC_CHANNELS.FOLDER_COMPARE_PROGRESS, { processed: result.stats.total, done: true });
      return result;
    } catch (err: any) {
      errorFile("Handler", `COMPARE_FOLDER failed: ${err.message}`, err);
      throw new Error(`Folder compare failed: ${err.message}`);
    }
  });
}
