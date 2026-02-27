/**
 * Pure compare engine — no Electron IPC dependency.
 * Used by compare-handlers.ts and directly by tests.
 */
import { compareSync, Options, Difference } from "dir-compare";
import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as crypto from "crypto";
import type { CompareItem, CompareState, CompareStats, FolderCompareResult } from "../../shared/types";
import { CompareState as CS } from "../../shared/types";
import { logFile } from "../file-logger";

export function mapEntryState(entry: Difference): CompareState {
  if (entry.state === "equal") return CS.EQUAL;
  if (entry.state === "left") return CS.ONLY_LEFT;
  if (entry.state === "right") return CS.ONLY_RIGHT;
  if (entry.state === "distinct") return CS.MODIFIED;
  return CS.ERROR;
}

export function isHiddenFile(name: string): boolean {
  return name.startsWith(".");
}

export function runFolderCompare(leftPath: string, rightPath: string, excludePatterns: string[]): FolderCompareResult {
  const start = Date.now();
  logFile("Compare", `Folder compare: ${leftPath} vs ${rightPath}`);
  if (excludePatterns.length > 0) {
    logFile("Compare", `  Exclude patterns: ${excludePatterns.join(", ")}`);
  }

  const options: Options = {
    compareContent: true,
    compareSize: true,
    excludeFilter: excludePatterns.length > 0 ? excludePatterns.join(",") : undefined,
    handlePermissionDenied: true,
  };

  const result = compareSync(leftPath, rightPath, options);
  const items: CompareItem[] = [];
  const stats: CompareStats = {
    equal: 0,
    modified: 0,
    onlyLeft: 0,
    onlyRight: 0,
    errors: 0,
    total: 0,
  };

  if (result.diffSet) {
    for (const entry of result.diffSet) {
      const name = entry.name1 || entry.name2 || "";
      // Strip leading slash from relativePath prefix to avoid double-slash when joining with base paths
      const relDir = entry.relativePath ? entry.relativePath.replace(/^[/\\]/, "") : "";
      const relativePath = relDir ? path.join(relDir, name) : name;
      const state = mapEntryState(entry);
      const isDir = entry.type1 === "directory" || entry.type2 === "directory";

      const item: CompareItem = {
        relativePath,
        name,
        type: isDir ? "directory" : "file",
        state,
        leftSize: entry.size1 ?? undefined,
        rightSize: entry.size2 ?? undefined,
        leftDate: entry.date1 ? new Date(entry.date1).getTime() : undefined,
        rightDate: entry.date2 ? new Date(entry.date2).getTime() : undefined,
        isHidden: isHiddenFile(name),
      };

      items.push(item);
      stats.total++;

      switch (state) {
        case CS.EQUAL:
          stats.equal++;
          break;
        case CS.MODIFIED:
          stats.modified++;
          break;
        case CS.ONLY_LEFT:
          stats.onlyLeft++;
          break;
        case CS.ONLY_RIGHT:
          stats.onlyRight++;
          break;
        case CS.ERROR:
          stats.errors++;
          break;
      }
    }
  }

  const duration = Date.now() - start;
  logFile(
    "Compare",
    `Result: ${stats.total} items (${stats.equal} equal, ${stats.modified} modified, ${stats.onlyLeft} only-left, ${stats.onlyRight} only-right, ${stats.errors} errors) in ${duration}ms`,
  );

  return { leftPath, rightPath, items, stats };
}

// ─── Async streaming compare ───────────────────────────────────────────────

/** Glob-match a single filename segment against a pattern (*, ?, no slash traversal). */
function globMatchSegment(name: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i").test(name);
}

/** Check if a directory/file name should be excluded. Handles trailing-slash patterns like "dist/". */
function shouldExcludeEntry(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((pat) => {
    const clean = pat.replace(/\/+$/, "").replace(/\\+$/, "");
    return globMatchSegment(name, clean);
  });
}

async function hashFile(filePath: string): Promise<string> {
  try {
    const buf = await fsp.readFile(filePath);
    return crypto.createHash("md5").update(buf).digest("hex");
  } catch {
    return "ERROR";
  }
}

interface WalkState {
  items: CompareItem[];
  stats: CompareStats;
  processed: number;
  onProgress: (processed: number) => void;
}

async function walkCompareDir(
  leftRoot: string,
  rightRoot: string,
  relDir: string,
  excludePatterns: string[],
  state: WalkState,
): Promise<void> {
  const leftAbs = relDir ? path.join(leftRoot, relDir) : leftRoot;
  const rightAbs = relDir ? path.join(rightRoot, relDir) : rightRoot;

  let leftEntries: fs.Dirent[] = [];
  let rightEntries: fs.Dirent[] = [];
  try {
    leftEntries = fs.readdirSync(leftAbs, { withFileTypes: true });
  } catch {}
  try {
    rightEntries = fs.readdirSync(rightAbs, { withFileTypes: true });
  } catch {}

  // Filter excluded entries
  const filterFn = (e: fs.Dirent) => !shouldExcludeEntry(e.name, excludePatterns);
  leftEntries = leftEntries.filter(filterFn);
  rightEntries = rightEntries.filter(filterFn);

  const leftByName = new Map(leftEntries.map((e) => [e.name, e]));
  const rightByName = new Map(rightEntries.map((e) => [e.name, e]));
  const allNames = new Set([...leftByName.keys(), ...rightByName.keys()]);
  const sortedNames = [...allNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  for (const name of sortedNames) {
    const le = leftByName.get(name);
    const re = rightByName.get(name);
    const isDir = (le?.isDirectory() ?? false) || (re?.isDirectory() ?? false);
    const relPath = relDir ? relDir + "/" + name : name;

    let leftStat: fs.Stats | undefined;
    let rightStat: fs.Stats | undefined;
    let itemState: CS;

    if (!le) {
      itemState = CS.ONLY_RIGHT;
      try {
        rightStat = fs.statSync(path.join(rightAbs, name));
      } catch {}
    } else if (!re) {
      itemState = CS.ONLY_LEFT;
      try {
        leftStat = fs.statSync(path.join(leftAbs, name));
      } catch {}
    } else if (isDir) {
      itemState = CS.EQUAL; // derived from children in the UI
    } else {
      // Both sides have this file
      try {
        leftStat = fs.statSync(path.join(leftAbs, name));
        rightStat = fs.statSync(path.join(rightAbs, name));
        if (leftStat.size !== rightStat.size) {
          itemState = CS.MODIFIED;
        } else {
          // Yield before potentially expensive content read
          await new Promise<void>((resolve) => setImmediate(resolve));
          const [lh, rh] = await Promise.all([hashFile(path.join(leftAbs, name)), hashFile(path.join(rightAbs, name))]);
          itemState = lh === rh ? CS.EQUAL : CS.MODIFIED;
        }
      } catch {
        itemState = CS.ERROR;
      }
    }

    const item: CompareItem = {
      relativePath: relPath,
      name,
      type: isDir ? "directory" : "file",
      state: itemState,
      leftSize: leftStat?.size,
      rightSize: rightStat?.size,
      leftDate: leftStat ? leftStat.mtimeMs : undefined,
      rightDate: rightStat ? rightStat.mtimeMs : undefined,
      isHidden: isHiddenFile(name),
    };

    state.items.push(item);
    state.stats.total++;

    if (isDir) {
      await walkCompareDir(leftRoot, rightRoot, relPath, excludePatterns, state);
    } else {
      state.processed++;
      switch (itemState) {
        case CS.EQUAL:
          state.stats.equal++;
          break;
        case CS.MODIFIED:
          state.stats.modified++;
          break;
        case CS.ONLY_LEFT:
          state.stats.onlyLeft++;
          break;
        case CS.ONLY_RIGHT:
          state.stats.onlyRight++;
          break;
        case CS.ERROR:
          state.stats.errors++;
          break;
      }
      // Report progress and yield every 20 files to keep event loop responsive
      if (state.processed % 20 === 0) {
        state.onProgress(state.processed);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }
}

/**
 * Async streaming folder comparison with progress callbacks.
 * Replaces the sync `runFolderCompare` for real-time progress reporting.
 */
export async function runFolderCompareStreaming(
  leftPath: string,
  rightPath: string,
  excludePatterns: string[],
  onProgress: (processed: number) => void,
): Promise<FolderCompareResult> {
  const start = Date.now();
  logFile("Compare", `Streaming folder compare: ${leftPath} vs ${rightPath}`);
  if (excludePatterns.length > 0) {
    logFile("Compare", `  Exclude patterns: ${excludePatterns.join(", ")}`);
  }

  const stats: CompareStats = {
    equal: 0,
    modified: 0,
    onlyLeft: 0,
    onlyRight: 0,
    errors: 0,
    total: 0,
  };

  const walkState: WalkState = {
    items: [],
    stats,
    processed: 0,
    onProgress,
  };

  await walkCompareDir(leftPath, rightPath, "", excludePatterns, walkState);

  // Final progress report
  onProgress(walkState.processed);

  const duration = Date.now() - start;
  logFile(
    "Compare",
    `Streaming result: ${stats.total} items (${stats.equal} equal, ${stats.modified} modified, ${stats.onlyLeft} only-left, ${stats.onlyRight} only-right) in ${duration}ms`,
  );

  return { leftPath, rightPath, items: walkState.items, stats };
}
