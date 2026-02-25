/**
 * Pure file utilities — no Electron IPC dependency.
 * Used by file-handlers.ts and directly by tests.
 */
import * as fs from "fs";
import * as path from "path";
import type { PathStat, FileStatInfo, HexChunk, HexRow } from "../../shared/types";
import { log, warn } from "../../shared/logger";

/** Detect binary content: scan first 8 KB for null bytes. */
export function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export async function readFileAsText(filePath: string): Promise<string> {
  log("File", `Reading text: ${filePath}`);
  return fs.promises.readFile(filePath, "utf-8");
}

export async function writeFileAsText(filePath: string, content: string): Promise<void> {
  log("File", `Writing text: ${filePath} (${content.length} chars)`);
  return fs.promises.writeFile(filePath, content, "utf-8");
}

export async function detectFileBinary(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await fd.read(buffer, 0, 8192, 0);
    await fd.close();
    const isBinary = isBinaryBuffer(buffer.subarray(0, bytesRead));
    log("File", `Binary detection for ${filePath}: ${isBinary ? "binary" : "text"}`);
    return isBinary;
  } catch (err) {
    warn("File", `Binary detection failed for ${filePath}`);
    return false;
  }
}

export async function readFileHex(filePath: string, offset: number, length: number): Promise<HexChunk> {
  log("File", `Reading hex: ${filePath} offset=${offset} length=${length}`);
  const stat = await fs.promises.stat(filePath);
  const totalSize = stat.size;
  const safeOffset = Math.min(offset, totalSize);
  const safeLength = Math.min(length, totalSize - safeOffset);

  if (safeLength <= 0) {
    log("File", `  No bytes to read (offset ${offset} >= size ${totalSize})`);
    return { offset: safeOffset, totalSize, rows: [] };
  }

  const fd = await fs.promises.open(filePath, "r");
  const buffer = Buffer.alloc(safeLength);
  const { bytesRead } = await fd.read(buffer, 0, safeLength, safeOffset);
  await fd.close();

  const rows: HexRow[] = [];
  for (let i = 0; i < bytesRead; i += 16) {
    const rowBytes = Array.from(buffer.subarray(i, Math.min(i + 16, bytesRead)));
    const ascii = rowBytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ".")).join("");
    rows.push({ offset: safeOffset + i, bytes: rowBytes, ascii });
  }

  log("File", `  Read ${rows.length} hex rows (${bytesRead} bytes)`);
  return { offset: safeOffset, totalSize, rows };
}

export async function getPathStat(p: string): Promise<PathStat> {
  try {
    const s = await fs.promises.stat(p);
    const type = s.isDirectory() ? "dir" : s.isFile() ? "file" : "?";
    log("File", `Stat ${p}: ${type} (${s.size} bytes)`);
    return {
      exists: true,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      size: s.size,
    };
  } catch {
    log("File", `Stat ${p}: not found`);
    return { exists: false, isDirectory: false, isFile: false, size: 0 };
  }
}

export async function getFileStat(p: string): Promise<FileStatInfo> {
  const s = await fs.promises.stat(p);
  const name = path.basename(p);
  // Check writable: try access W_OK
  let readonly = false;
  try {
    await fs.promises.access(p, fs.constants.W_OK);
  } catch {
    readonly = true;
  }
  return {
    size: s.size,
    birthtime: s.birthtimeMs,
    mtime: s.mtimeMs,
    readonly,
    hidden: name.startsWith("."),
  };
}
