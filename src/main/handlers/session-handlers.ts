import { ipcMain, app } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type { PersistedState } from "../../shared/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function getSessionsPath(): string {
  return path.join(app.getPath("userData"), "sessions.json");
}

export function registerSessionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_SAVE_ALL, async (_event, state: PersistedState) => {
    const filePath = getSessionsPath();
    const tmpPath = filePath + ".tmp";
    const dir = path.dirname(filePath);

    try {
      // Ensure directory exists
      await fs.promises.mkdir(dir, { recursive: true });

      // Write to temp file
      const jsonStr = JSON.stringify(state, null, 2);
      await fs.promises.writeFile(tmpPath, jsonStr, "utf-8");

      // Verify temp file exists before rename
      if (!fs.existsSync(tmpPath)) {
        throw new Error(`Failed to write temp file: ${tmpPath}`);
      }

      // Attempt atomic rename
      try {
        await fs.promises.rename(tmpPath, filePath);
      } catch (renameErr: any) {
        // If target already exists and temp doesn't, another concurrent save succeeded first
        if (renameErr.code === "ENOENT" && fs.existsSync(filePath) && !fs.existsSync(tmpPath)) {
          // This is OK - the file was already saved by another request
          console.log("[SessionHandler] File already saved by concurrent request, skipping");
          return;
        }
        // Otherwise, if target exists but temp exists too, try to force overwrite
        if (fs.existsSync(filePath) && fs.existsSync(tmpPath)) {
          await fs.promises.unlink(filePath);
          await fs.promises.rename(tmpPath, filePath);
          return;
        }
        throw renameErr;
      }
    } catch (err: any) {
      // Clean up temp file on failure
      try {
        if (fs.existsSync(tmpPath)) {
          await fs.promises.unlink(tmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      console.error("[SessionHandler] Save failed:", {
        file: filePath,
        error: err.message,
        code: err.code,
      });

      // Don't throw - allow renderer to continue. Losing sessions on an error is acceptable.
    }
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD_ALL, async () => {
    try {
      const filePath = getSessionsPath();
      if (!fs.existsSync(filePath)) return null;
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as PersistedState;
      // Validate version
      if (typeof parsed.version !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  });
}
