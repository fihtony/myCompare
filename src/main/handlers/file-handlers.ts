import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { readFileAsText, writeFileAsText, detectFileBinary, readFileHex, getPathStat, getFileStat } from "../core/file-utils";
import { logFile, errorFile, warnFile } from "../file-logger";

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath: string) => {
    try {
      logFile("Handler", `FILE_READ IPC: ${filePath}`);
      return readFileAsText(filePath);
    } catch (err: any) {
      errorFile("Handler", `FILE_READ failed: ${filePath}`, err);
      throw new Error(`Failed to read file: ${err.message}`);
    }
  });

  /**
   * Read up to `maxLines` lines from a file without loading the entire file into memory.
   * Uses a readline stream so only the requested portion is ever in the heap.
   */
  ipcMain.handle(IPC_CHANNELS.FILE_READ_LINES, async (_event, filePath: string, maxLines: number) => {
    logFile("Handler", `FILE_READ_LINES IPC: ${filePath} (max ${maxLines} lines)`);
    return new Promise<{ content: string; truncated: boolean; lineCount: number }>((resolve, reject) => {
      const lines: string[] = [];
      let truncated = false;
      const stream = fs.createReadStream(filePath, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on("line", (line: string) => {
        if (lines.length >= maxLines) {
          if (!truncated) {
            truncated = true;
            rl.close();
            stream.destroy();
          }
          return;
        }
        lines.push(line);
      });

      rl.on("close", () => {
        logFile("Handler", `FILE_READ_LINES done: ${lines.length} lines (truncated=${truncated})`);
        resolve({ content: lines.join("\n"), truncated, lineCount: lines.length });
      });

      rl.on("error", (err: Error) => {
        errorFile("Handler", `FILE_READ_LINES failed: ${filePath}`, err);
        reject(err);
      });
      stream.on("error", (err: Error) => {
        errorFile("Handler", `FILE_READ_LINES stream error: ${filePath}`, err);
        reject(err);
      });
    });
  });

  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_event, filePath: string, content: string) => {
    try {
      logFile("Handler", `FILE_WRITE IPC: ${filePath} (${content.length} chars)`);
      await writeFileAsText(filePath, content);
    } catch (err: any) {
      errorFile("Handler", `FILE_WRITE failed: ${filePath}`, err);
      throw new Error(`Failed to write file: ${err.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_DETECT_BINARY, async (_event, filePath: string) => {
    try {
      logFile("Handler", `FILE_DETECT_BINARY IPC: ${filePath}`);
      return detectFileBinary(filePath);
    } catch (err: any) {
      warnFile("Handler", `FILE_DETECT_BINARY error: ${filePath}`, err);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_READ_HEX, async (_event, filePath: string, offset: number, length: number) => {
    try {
      logFile("Handler", `FILE_READ_HEX IPC: ${filePath} (offset=${offset}, length=${length})`);
      return readFileHex(filePath, offset, length);
    } catch (err: any) {
      errorFile("Handler", `FILE_READ_HEX failed: ${filePath}`, err);
      throw new Error(`Failed to read hex: ${err.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.PATH_STAT, async (_event, p: string) => {
    try {
      logFile("Handler", `PATH_STAT IPC: ${p}`);
      return getPathStat(p);
    } catch (err: any) {
      errorFile("Handler", `PATH_STAT failed: ${p}`, err);
      return { exists: false, isDirectory: false, isFile: false, size: 0 };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_STAT, async (_event, filePath: string) => {
    try {
      logFile("Handler", `FILE_STAT IPC: ${filePath}`);
      return getFileStat(filePath);
    } catch (err: any) {
      errorFile("Handler", `FILE_STAT failed: ${filePath}`, err);
      throw new Error(`Failed to stat file: ${err.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_COPY, async (_event, src: string, dst: string) => {
    try {
      logFile("Handler", `FILE_COPY IPC: ${src} -> ${dst}`);
      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      await fs.promises.copyFile(src, dst);
    } catch (err: any) {
      errorFile("Handler", `FILE_COPY failed: ${src} -> ${dst}`, err);
      throw new Error(`Failed to copy file: ${err.message}`);
    }
  });
}
