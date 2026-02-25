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
    try {
      const filePath = getSessionsPath();
      const tmpPath = filePath + ".tmp";
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
      await fs.promises.rename(tmpPath, filePath);
    } catch (err: any) {
      throw new Error(`Failed to save sessions: ${err.message}`);
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
