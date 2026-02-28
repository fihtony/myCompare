/**
 * Hook encapsulating the file-loading & diff-computation logic.
 */
import { useCallback } from "react";
import { computeDiff } from "../../utils/diff";
import { log, error as logError } from "../../../shared/logger";
import type { FileDiffState } from "./useFileDiffState";

/** Files larger than this are loaded with the streaming line-reader to avoid OOM. */
export const LARGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Max lines per side when loading a large file. */
export const LARGE_FILE_MAX_LINES = 50_000;

export function useFileLoader(state: FileDiffState) {
  const {
    setLeftContent,
    setRightContent,
    setLeftPath,
    setRightPath,
    setDiffLines,
    setTableKey,
    setLoading,
    setError,
    setIsBinary,
    setLeftDirty,
    setRightDirty,
    setLeftStat,
    setRightStat,
    setLargeFileInfo,
    originalLeftContentRef,
    originalRightContentRef,
    undoStackRef,
  } = state;

  const loadAndCompare = useCallback(async (lp: string, rp: string) => {
    if (!lp && !rp) return;
    setLoading(true);
    setError(null);
    setLargeFileInfo(null);
    setLeftDirty(false);
    setRightDirty(false);
    // Reset undo stack on new file load
    undoStackRef.current = [];
    log("FileDiff", `Loading files: "${lp}" vs "${rp}"`);

    try {
      // One-sided view: only one path provided (e.g. orphan file from folder compare)
      if (!lp || !rp) {
        const existingPath = (lp || rp) as string;
        const isBin = await window.electronAPI.fileDetectBinary(existingPath);
        if (isBin) {
          setIsBinary(true);
          setDiffLines([]);
          setLeftContent("");
          setRightContent("");
          return;
        }
        setIsBinary(false);
        const stat = await window.electronAPI.fileStat(existingPath).catch(() => null);
        let content: string;
        if ((stat?.size ?? 0) > LARGE_FILE_BYTES) {
          const result = await window.electronAPI.fileReadLines(existingPath, LARGE_FILE_MAX_LINES);
          content = result.content;
          if (result.truncated) setLargeFileInfo({ leftTruncated: !!lp, rightTruncated: !!rp });
        } else {
          content = await window.electronAPI.fileRead(existingPath);
        }
        if (lp) {
          setLeftContent(content);
          setRightContent("");
          setDiffLines(computeDiff(content.split("\n"), []));
          originalLeftContentRef.current = content;
          originalRightContentRef.current = "";
        } else {
          setRightContent(content);
          setLeftContent("");
          setDiffLines(computeDiff([], content.split("\n")));
          originalLeftContentRef.current = "";
          originalRightContentRef.current = content;
        }
        setTableKey((k) => k + 1);
        return;
      }

      const [leftBin, rightBin] = await Promise.all([window.electronAPI.fileDetectBinary(lp), window.electronAPI.fileDetectBinary(rp)]);
      log("FileDiff", `Binary detection: left=${leftBin ? "binary" : "text"}, right=${rightBin ? "binary" : "text"}`);
      if (leftBin || rightBin) {
        setIsBinary(true);
        setDiffLines([]);
        setLeftContent("");
        setRightContent("");
        return;
      }
      setIsBinary(false);

      const [lStatPre, rStatPre] = await Promise.all([
        window.electronAPI.fileStat(lp).catch(() => null),
        window.electronAPI.fileStat(rp).catch(() => null),
      ]);
      const lSize = lStatPre?.size ?? 0;
      const rSize = rStatPre?.size ?? 0;
      const isLargeFile = lSize > LARGE_FILE_BYTES || rSize > LARGE_FILE_BYTES;

      let left: string;
      let right: string;
      if (isLargeFile) {
        log(
          "FileDiff",
          `Large file detected (${(lSize / 1048576).toFixed(1)} MB / ${(rSize / 1048576).toFixed(1)} MB) — using streaming reader`,
        );
        const [lResult, rResult] = await Promise.all([
          window.electronAPI.fileReadLines(lp, LARGE_FILE_MAX_LINES),
          window.electronAPI.fileReadLines(rp, LARGE_FILE_MAX_LINES),
        ]);
        left = lResult.content;
        right = rResult.content;
        if (lResult.truncated || rResult.truncated) {
          setLargeFileInfo({ leftTruncated: lResult.truncated, rightTruncated: rResult.truncated });
        }
      } else {
        [left, right] = await Promise.all([window.electronAPI.fileRead(lp), window.electronAPI.fileRead(rp)]);
      }

      setLeftContent(left);
      setRightContent(right);
      originalLeftContentRef.current = left;
      originalRightContentRef.current = right;

      const diffResult = computeDiff(left.split("\n"), right.split("\n"));
      log(
        "FileDiff",
        `Diff computed: ${diffResult.length} lines (${diffResult.filter((d) => d.type === "added").length} added, ${diffResult.filter((d) => d.type === "removed").length} removed)`,
      );
      setDiffLines(diffResult);
      setTableKey((k) => k + 1);

      // Load file stats (best-effort)
      try {
        const [ls, rs] = isLargeFile
          ? [lStatPre, rStatPre]
          : await Promise.all([window.electronAPI.fileStat(lp), window.electronAPI.fileStat(rp)]);
        setLeftStat(ls);
        setRightStat(rs);
      } catch {
        setLeftStat(null);
        setRightStat(null);
      }
    } catch (err: any) {
      const msg = err.message || "Failed to load files";
      logError("FileDiff", msg, err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectLeft = async (currentRightPath: string) => {
    const p = await window.electronAPI.dialogSelectFile();
    if (p) {
      setLeftPath(p);
      loadAndCompare(p, currentRightPath);
    }
  };

  const handleSelectRight = async (currentLeftPath: string) => {
    const p = await window.electronAPI.dialogSelectFile();
    if (p) {
      setRightPath(p);
      loadAndCompare(currentLeftPath, p);
    }
  };

  return { loadAndCompare, handleSelectLeft, handleSelectRight };
}
