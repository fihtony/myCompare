/**
 * File-based logger for the main process.
 * Writes logs to:
 * - Development: <project-root>/logs/[date].log
 * - Production: ~/Library/Application Support/myCompare/logs/[date].log (macOS)
 */
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

let logsDir: string;

/** Initialize logs directory. Call this early in main.ts */
export function initFileLogger(): void {
  // In development: use project root /logs
  // In production: use app userData directory /logs
  if (!app.isPackaged) {
    logsDir = path.join(process.cwd(), "logs");
  } else {
    logsDir = path.join(app.getPath("userData"), "logs");
  }

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (err) {
    console.error("[FileLogger] Failed to create logs directory:", err);
  }
}

function getLogFilePath(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(logsDir, `${date}.log`);
}

/** Format timestamp as HH:MM:SS.mmm */
function getTimestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function writeToFile(level: string, source: string, message: string, ...args: any[]): void {
  if (!logsDir) return;

  try {
    const timestamp = getTimestamp();
    const prefix = `${timestamp} [${level}] [${source}]`;
    const argsStr = args.length ? " " + JSON.stringify(args) : "";
    const line = `${prefix} ${message}${argsStr}\n`;

    fs.appendFileSync(getLogFilePath(), line, "utf-8");
  } catch (err) {
    console.error("[FileLogger] Write error:", err);
  }
}

export function logFile(source: string, message: string, ...args: any[]): void {
  const prefix = `[${source}]`;
  console.log(prefix, message, ...args);
  writeToFile("INFO", source, message, ...args);
}

export function warnFile(source: string, message: string, ...args: any[]): void {
  const prefix = `[${source}]`;
  console.warn(prefix, message, ...args);
  writeToFile("WARN", source, message, ...args);
}

export function errorFile(source: string, message: string, err?: Error | unknown): void {
  const prefix = `[${source}]`;
  const errMsg = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? err.stack : "";
  if (err instanceof Error) {
    console.error(prefix, message, err.message);
    writeToFile("ERROR", source, message, errMsg, errStack);
  } else if (err) {
    console.error(prefix, message, String(err));
    writeToFile("ERROR", source, message, String(err));
  } else {
    console.error(prefix, message);
    writeToFile("ERROR", source, message);
  }
}
