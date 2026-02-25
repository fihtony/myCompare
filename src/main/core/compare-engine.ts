/**
 * Pure compare engine — no Electron IPC dependency.
 * Used by compare-handlers.ts and directly by tests.
 */
import { compareSync, Options, Difference } from "dir-compare";
import * as path from "path";
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
