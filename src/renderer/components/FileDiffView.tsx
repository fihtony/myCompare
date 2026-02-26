import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { FileSession, FileStatInfo, FolderSession } from "@shared/types";
import { useSessionStore } from "../store/session-store";
import { computeDiff, detectLanguage, computeCharDiff } from "../utils/diff";
import type { DiffLine } from "../utils/diff";
import HexDiffView from "./HexDiffView";
import { log, error as logError } from "../../shared/logger";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";
import "./FileDiffView.css";

interface Props {
  session: FileSession;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

function highlightLine(text: string, lang: string): string {
  if (!text || lang === "plaintext") return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

function ThumbnailStrip({ data }: { data: string[] }) {
  return (
    <div className="fd-thumbnail">
      {data.map((color, i) => (
        <div
          key={i}
          className="fd-thumb-line"
          style={{ background: color }}
          onClick={() => document.getElementById(`diff-row-${i}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
        />
      ))}
    </div>
  );
}

/** Files larger than this are loaded with the streaming line-reader to avoid OOM. */
const LARGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Max lines per side when loading a large file. */
const LARGE_FILE_MAX_LINES = 50_000;

/**
 * Module-level Set of session IDs that have unsaved changes.
 * TabStrip reads this before closing a tab to prompt the user.
 */
export const _dirtyFileSessions = new Set<string>();

export default function FileDiffView({ session }: Props) {
  const { updateSession, sessions } = useSessionStore();
  const [leftContent, setLeftContent] = useState<string>("");
  const [rightContent, setRightContent] = useState<string>("");
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftPath, setLeftPath] = useState(session.leftPath);
  const [rightPath, setRightPath] = useState(session.rightPath);
  const [currentDiffIdx, setCurrentDiffIdx] = useState(-1);
  const [isBinary, setIsBinary] = useState(false);
  const [syntaxOn, setSyntaxOn] = useState(true);
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [leftStat, setLeftStat] = useState<FileStatInfo | null>(null);
  const [rightStat, setRightStat] = useState<FileStatInfo | null>(null);
  /** Set when a file exceeds LARGE_FILE_BYTES and was loaded in truncated streaming mode. */
  const [largeFileInfo, setLargeFileInfo] = useState<{
    leftTruncated: boolean;
    rightTruncated: boolean;
  } | null>(null);
  /** Undo stack: each entry is a snapshot of {leftContent, rightContent} before an edit. */
  const undoStackRef = useRef<Array<{ lc: string; rc: string }>>([]);
  /** Increment to force full remount of the diff table (after file load or inline edit commit). */
  const [tableKey, setTableKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Which cell is currently being typed into — prevents React from overwriting the user’s DOM text. */
  const editingCellRef = useRef<{ idx: number; side: "left" | "right"; text: string } | null>(null);
  /** Debounce timer for on-input live diff recompute. */
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stores the mousedown coordinates so we can restore caret position after activating edit. */
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Rows selected via line-number clicks for bulk copy. */
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  /** Last row index clicked (for Shift+click range selection). */
  const lastClickedRowRef = useRef<number | null>(null);
  /** Tracks active mouse-drag row selection (start row + whether button is held). */
  const dragSelectRef = useRef<{ active: boolean; startIdx: number } | null>(null);
  /** Ref to the fd-diff-table element — used for text-selection side isolation. */
  const tableDivRef = useRef<HTMLDivElement>(null);
  /**
   * Which cell is currently in edit mode. Only this cell gets contentEditable="plaintext-only";
   * all others are plain read-only divs, which allows native multi-row text selection.
   */
  const [activeEditCell, setActiveEditCell] = useState<{ idx: number; side: "left" | "right" } | null>(null);

  /** True when only one side has a file (orphan from folder compare). */
  const isOrphanMode = !leftPath || !rightPath;

  /** Reconstruct left file content from current diffLines (excludes "added" rows which are right-only) */
  const reconstructLeft = (lines: DiffLine[]) =>
    lines
      .filter((d) => d.type !== "added")
      .map((d) => d.leftText)
      .join("\n");

  /** Reconstruct right file content from current diffLines (excludes "removed" rows which are left-only) */
  const reconstructRight = (lines: DiffLine[]) =>
    lines
      .filter((d) => d.type !== "removed")
      .map((d) => d.rightText)
      .join("\n");

  /** Save a snapshot of current content to the undo stack before any mutation. */
  const pushUndo = () => {
    undoStackRef.current.push({ lc: leftContent, rc: rightContent });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
  };

  /** Revert the last edit operation. */
  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    const { lc, rc } = prev;
    setLeftContent(lc);
    setRightContent(rc);
    setDiffLines(computeDiff(lc.split("\n"), rc.split("\n")));
    setTableKey((k) => k + 1);
    setLeftDirty(true);
    setRightDirty(true);
  }, []);

  /** Contiguous groups of non-equal diff lines, plus a row→group index map. */
  const { groups, rowGroupIdx } = useMemo(() => {
    const groups: number[][] = [];
    const rowGroupIdx = new Array<number>(diffLines.length).fill(-1);
    let i = 0;
    while (i < diffLines.length) {
      if (diffLines[i].type !== "equal") {
        const gi = groups.length;
        const indices: number[] = [];
        while (i < diffLines.length && diffLines[i].type !== "equal") {
          indices.push(i);
          rowGroupIdx[i] = gi;
          i++;
        }
        groups.push(indices);
      } else {
        i++;
      }
    }
    return { groups, rowGroupIdx };
  }, [diffLines]);

  /**
   * Commit an inline edit for one line and recompute the diff.
   * Called on contentEditable blur when the text has actually changed.
   */
  const handleInlineEdit = useCallback(
    (side: "left" | "right", lineIdx: number, newText: string) => {
      pushUndo();
      const updated = diffLines.map((d, i) =>
        i !== lineIdx ? d : side === "left" ? { ...d, leftText: newText } : { ...d, rightText: newText },
      );
      const newLeft = reconstructLeft(updated);
      const newRight = reconstructRight(updated);
      if (side === "left") {
        setLeftContent(newLeft);
        setLeftDirty(true);
      } else {
        setRightContent(newRight);
        setRightDirty(true);
      }
      setDiffLines(computeDiff(newLeft.split("\n"), newRight.split("\n")));
      setTableKey((k) => k + 1);
    },
    [diffLines],
  );

  const lang = useMemo(() => detectLanguage(leftPath || rightPath), [leftPath, rightPath]);

  const loadAndCompare = useCallback(async (lp: string, rp: string) => {
    if (!lp && !rp) return;
    setLoading(true);
    setError(null);
    setLargeFileInfo(null);
    setLeftDirty(false);
    setRightDirty(false);
    log("FileDiff", `Loading files: "${lp}" vs "${rp}"`);
    try {
      // One-sided view: only one path provided (e.g. file only-left or only-right from folder compare)
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
        // Use streaming reader for large one-sided files.
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
        } else {
          setRightContent(content);
          setLeftContent("");
          setDiffLines(computeDiff([], content.split("\n")));
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

      // Check file sizes before loading to avoid OOM with large files.
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
      const diffResult = computeDiff(left.split("\n"), right.split("\n"));
      log(
        "FileDiff",
        `Diff computed: ${diffResult.length} lines (${diffResult.filter((d) => d.type === "added").length} added, ${diffResult.filter((d) => d.type === "removed").length} removed)`,
      );
      setDiffLines(diffResult);
      setTableKey((k) => k + 1);
      // Load file stats (best-effort, don't fail the whole load)
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
  }, []);

  useEffect(() => {
    if (session.leftPath || session.rightPath) {
      setLeftPath(session.leftPath);
      setRightPath(session.rightPath);
      loadAndCompare(session.leftPath, session.rightPath);
    }
  }, [session.leftPath, session.rightPath]);

  // Ctrl+Z / Cmd+Z undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        // Only intercept if focus is not inside a contentEditable (let browser handle there)
        const active = document.activeElement;
        if (active && (active as HTMLElement).contentEditable === "plaintext-only") return;
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo]);

  // Keep the module-level dirty registry in sync so TabStrip can check before closing.
  useEffect(() => {
    if (leftDirty || rightDirty) {
      _dirtyFileSessions.add(session.id);
    } else {
      _dirtyFileSessions.delete(session.id);
    }
    return () => {
      _dirtyFileSessions.delete(session.id);
    };
  }, [leftDirty, rightDirty, session.id]);

  // Auto-focus and place caret in the cell that just became active for editing.
  useEffect(() => {
    if (!activeEditCell) return;
    const id = `cell-${activeEditCell.idx}-${activeEditCell.side === "left" ? "l" : "r"}`;
    // Use setTimeout so React has flushed the contentEditable attribute to the DOM.
    const timer = setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.focus();
      // Restore caret to where the user clicked (caretRangeFromPoint is Chromium-specific).
      const pos = mouseDownPosRef.current;
      if (pos) {
        const caretRange = (document as any).caretRangeFromPoint?.(pos.x, pos.y) as Range | null;
        if (caretRange && el.contains(caretRange.startContainer)) {
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(caretRange);
          return;
        }
      }
      // Fallback: place caret at end.
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeEditCell]);

  /**
   * Mark which column (left/right) the user has started a text-selection drag on.
   * Adds a CSS class to the table that hides the opposite column from selection,
   * preventing the browser selection from jumping across to the other side.
   */
  const startTextSelect = useCallback((side: "left" | "right") => {
    const el = tableDivRef.current;
    if (!el) return;
    el.classList.remove("fd-selecting-left", "fd-selecting-right");
    el.classList.add(`fd-selecting-${side}`);
  }, []);

  // Cross-line text selection: intercept Ctrl+C to produce clean multi-line text
  // (without line-number / button artifacts) when the user drags across rows.
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const tableEl = tableDivRef.current;
      if (!tableEl) return;

      const isSelectingLeft = tableEl.classList.contains("fd-selecting-left");
      const isSelectingRight = tableEl.classList.contains("fd-selecting-right");
      if (!isSelectingLeft && !isSelectingRight) return;

      const range = sel.getRangeAt(0);
      if (!tableEl.contains(range.commonAncestorContainer)) return;

      const sideClass = isSelectingLeft ? ".fd-line-left" : ".fd-line-right";
      const cells = Array.from(tableEl.querySelectorAll(sideClass)) as HTMLElement[];

      const lines: string[] = [];
      for (const cell of cells) {
        const cellRange = document.createRange();
        cellRange.selectNodeContents(cell);
        try {
          // Skip cell if the selection ends before it starts
          if (range.compareBoundaryPoints(Range.END_TO_START, cellRange) <= 0) continue;
          // Stop scanning if the selection starts after cell ends
          if (range.compareBoundaryPoints(Range.START_TO_END, cellRange) >= 0) break;
        } catch {
          continue;
        }
        // Clip the selection range to this cell's bounds
        const intersect = range.cloneRange();
        try {
          if (range.compareBoundaryPoints(Range.START_TO_START, cellRange) < 0)
            intersect.setStart(cellRange.startContainer, cellRange.startOffset);
          if (range.compareBoundaryPoints(Range.END_TO_END, cellRange) > 0) intersect.setEnd(cellRange.endContainer, cellRange.endOffset);
        } catch {
          lines.push(cell.textContent ?? "");
          continue;
        }
        lines.push(intersect.toString());
      }

      if (lines.length > 0) {
        e.preventDefault();
        e.clipboardData?.setData("text/plain", lines.join("\n"));
      }
    };

    document.addEventListener("copy", handleCopy);
    return () => {
      document.removeEventListener("copy", handleCopy);
    };
  }, []);

  const handleCompare = () => {
    updateSession(session.id, { leftPath, rightPath } as any);
    updateSession(session.id, { name: leftPath.split("/").pop() || "File Compare" } as any);
    loadAndCompare(leftPath, rightPath);
  };

  const handleSelectLeft = async () => {
    const p = await window.electronAPI.dialogSelectFile();
    if (p) setLeftPath(p);
  };

  const handleSelectRight = async () => {
    const p = await window.electronAPI.dialogSelectFile();
    if (p) setRightPath(p);
  };

  const handleSaveLeft = async () => {
    try {
      let savePath = leftPath;
      if (!savePath) {
        // Orphan file — no left path yet. Derive default from parent folder session.
        const parentFolder = session.parentSessionId
          ? (sessions.find((s) => s.id === session.parentSessionId && s.type === "folder") as FolderSession | undefined)
          : undefined;
        const defaultSavePath =
          parentFolder && rightPath.startsWith(parentFolder.rightPath)
            ? parentFolder.leftPath + rightPath.slice(parentFolder.rightPath.length)
            : rightPath;
        savePath = (await window.electronAPI.dialogSaveFile(defaultSavePath)) ?? "";
        if (!savePath) return;
        setLeftPath(savePath);
      }
      await window.electronAPI.fileWrite(savePath, leftContent);
      setLeftDirty(false);
      log("FileDiff", `Saved left: ${savePath}`);
    } catch (err: any) {
      logError("FileDiff", `Save left failed: ${err.message}`, err);
    }
  };

  const handleSaveRight = async () => {
    try {
      let savePath = rightPath;
      if (!savePath) {
        // Orphan file — no right path yet. Derive default from parent folder session.
        const parentFolder = session.parentSessionId
          ? (sessions.find((s) => s.id === session.parentSessionId && s.type === "folder") as FolderSession | undefined)
          : undefined;
        const defaultSavePath =
          parentFolder && leftPath.startsWith(parentFolder.leftPath)
            ? parentFolder.rightPath + leftPath.slice(parentFolder.leftPath.length)
            : leftPath;
        savePath = (await window.electronAPI.dialogSaveFile(defaultSavePath)) ?? "";
        if (!savePath) return;
        setRightPath(savePath);
      }
      await window.electronAPI.fileWrite(savePath, rightContent);
      setRightDirty(false);
      log("FileDiff", `Saved right: ${savePath}`);
    } catch (err: any) {
      logError("FileDiff", `Save right failed: ${err.message}`, err);
    }
  };

  /** Stage all left content into right — does NOT write to disk until Save is clicked */
  const handleCopyLeftToRight = () => {
    pushUndo();
    setRightContent(leftContent);
    setRightDirty(true);
    setDiffLines(computeDiff(leftContent.split("\n"), leftContent.split("\n")));
  };

  /** Stage all right content into left — does NOT write to disk until Save is clicked */
  const handleCopyRightToLeft = () => {
    pushUndo();
    setLeftContent(rightContent);
    setLeftDirty(true);
    setDiffLines(computeDiff(rightContent.split("\n"), rightContent.split("\n")));
  };

  /** Copy single diff line's left text to the right side */
  const copyLineToRight = (idx: number) => {
    pushUndo();
    const newLines = diffLines.map((d, i) => (i === idx ? { ...d, type: "equal" as const, rightText: d.leftText } : d));
    setDiffLines(newLines);
    setRightContent(reconstructRight(newLines));
    setRightDirty(true);
    setSelectedRows(new Set());
  };

  /** Copy single diff line's right text to the left side */
  const copyLineToLeft = (idx: number) => {
    pushUndo();
    const newLines = diffLines.map((d, i) => (i === idx ? { ...d, type: "equal" as const, leftText: d.rightText } : d));
    setDiffLines(newLines);
    setLeftContent(reconstructLeft(newLines));
    setLeftDirty(true);
    setSelectedRows(new Set());
  };

  /** Copy an entire contiguous diff group (section) to the right side. */
  const copyGroupToRight = (groupIdx: number) => {
    pushUndo();
    const groupSet = new Set(groups[groupIdx]);
    const newRight: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      if (!groupSet.has(i)) {
        if (line.type !== "removed") newRight.push(line.rightText);
      } else {
        if (line.type === "removed")
          newRight.push(line.leftText); // add to right
        else if (line.type === "added") {
          /* skip — delete from right */
        } else {
          newRight.push(line.leftText); // modified/whitespace: use left
        }
      }
    }
    const newRc = newRight.join("\n");
    setRightContent(newRc);
    setRightDirty(true);
    setDiffLines(computeDiff(leftContent.split("\n"), newRc.split("\n")));
    setTableKey((k) => k + 1);
    setSelectedRows(new Set());
  };

  /** Copy an entire contiguous diff group (section) to the left side. */
  const copyGroupToLeft = (groupIdx: number) => {
    pushUndo();
    const groupSet = new Set(groups[groupIdx]);
    const newLeft: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      if (!groupSet.has(i)) {
        if (line.type !== "added") newLeft.push(line.leftText);
      } else {
        if (line.type === "added")
          newLeft.push(line.rightText); // add to left
        else if (line.type === "removed") {
          /* skip — delete from left */
        } else {
          newLeft.push(line.rightText); // modified/whitespace: use right
        }
      }
    }
    const newLc = newLeft.join("\n");
    setLeftContent(newLc);
    setLeftDirty(true);
    setDiffLines(computeDiff(newLc.split("\n"), rightContent.split("\n")));
    setTableKey((k) => k + 1);
    setSelectedRows(new Set());
  };

  /** Same as handleInlineEdit but skips tableKey reset so the active contentEditable keeps focus. */
  const handleInlineEditSoft = useCallback(
    (side: "left" | "right", lineIdx: number, newText: string) => {
      const updated = diffLines.map((d, i) =>
        i !== lineIdx ? d : side === "left" ? { ...d, leftText: newText } : { ...d, rightText: newText },
      );
      const newLeft = reconstructLeft(updated);
      const newRight = reconstructRight(updated);
      if (side === "left") {
        setLeftContent(newLeft);
        setLeftDirty(true);
      } else {
        setRightContent(newRight);
        setRightDirty(true);
      }
      setDiffLines(computeDiff(newLeft.split("\n"), newRight.split("\n")));
      // intentionally no setTableKey — keep the editing cell alive
    },
    [diffLines],
  );

  /** Copy arbitrary selected rows to the right side. */
  const copySelectedToRight = useCallback(() => {
    if (selectedRows.size === 0) return;
    pushUndo();
    const newRight: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      const sel = selectedRows.has(i);
      if (line.type === "equal") {
        newRight.push(line.rightText);
      } else if (line.type === "added") {
        if (!sel) newRight.push(line.rightText); // keep if not in selection
      } else if (line.type === "removed") {
        if (sel) newRight.push(line.leftText); // add to right
      } else {
        // modified / whitespace
        newRight.push(sel ? line.leftText : line.rightText);
      }
    }
    const newRc = newRight.join("\n");
    setRightContent(newRc);
    setRightDirty(true);
    setDiffLines(computeDiff(leftContent.split("\n"), newRc.split("\n")));
    setTableKey((k) => k + 1);
    setSelectedRows(new Set());
  }, [diffLines, leftContent, selectedRows]);

  /** Copy arbitrary selected rows to the left side. */
  const copySelectedToLeft = useCallback(() => {
    if (selectedRows.size === 0) return;
    pushUndo();
    const newLeft: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      const sel = selectedRows.has(i);
      if (line.type === "equal") {
        newLeft.push(line.leftText);
      } else if (line.type === "removed") {
        if (!sel) newLeft.push(line.leftText);
      } else if (line.type === "added") {
        if (sel) newLeft.push(line.rightText);
      } else {
        newLeft.push(sel ? line.rightText : line.leftText);
      }
    }
    const newLc = newLeft.join("\n");
    setLeftContent(newLc);
    setLeftDirty(true);
    setDiffLines(computeDiff(newLc.split("\n"), rightContent.split("\n")));
    setTableKey((k) => k + 1);
    setSelectedRows(new Set());
  }, [diffLines, rightContent, selectedRows]);

  /** Toggle single row selection; Shift+click extends range. */
  const handleRowLineNoClick = useCallback(
    (idx: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && lastClickedRowRef.current !== null) {
          const from = Math.min(lastClickedRowRef.current, idx);
          const to = Math.max(lastClickedRowRef.current, idx);
          for (let j = from; j <= to; j++) {
            if (diffLines[j]?.type !== "equal") next.add(j);
          }
        } else {
          if (next.has(idx)) next.delete(idx);
          else next.add(idx);
          lastClickedRowRef.current = idx;
        }
        return next;
      });
    },
    [diffLines],
  );

  /** Flat array of all non-equal diff line indices (for goNext/goPrev navigation). */
  const diffIndices = diffLines.map((d, i) => (d.type !== "equal" ? i : -1)).filter((i) => i >= 0);
  const diffCount = diffIndices.length;

  const goNext = () => {
    if (!diffIndices.length) return;
    const next = diffIndices.find((i) => i > currentDiffIdx) ?? diffIndices[0];
    setCurrentDiffIdx(next);
    document.getElementById(`diff-row-${next}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const goPrev = () => {
    if (!diffIndices.length) return;
    const prev = [...diffIndices].reverse().find((i) => i < currentDiffIdx) ?? diffIndices[diffIndices.length - 1];
    setCurrentDiffIdx(prev);
    document.getElementById(`diff-row-${prev}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const thumbnailData = diffLines.map((d) => {
    if (d.type === "added") return "var(--diff-added-line)";
    if (d.type === "removed") return "var(--diff-removed-line)";
    if (d.type === "modified") return "var(--diff-modified-line)";
    if (d.type === "whitespace") return "var(--diff-whitespace-line, #5b8dd9)";
    return "transparent";
  });

  return (
    <div className="file-diff">
      {/* Toolbar */}
      <div className="fd-toolbar">
        <button
          className="icon-btn"
          onClick={() => {
            // Swap paths and in-memory content, preserving unsaved edits
            const nl = rightPath,
              nr = leftPath;
            const nlc = rightContent,
              nrc = leftContent;
            const nld = rightDirty,
              nrd = leftDirty;
            const nls = rightStat,
              nrs = leftStat;
            setLeftPath(nl);
            setRightPath(nr);
            setLeftContent(nlc);
            setRightContent(nrc);
            setLeftDirty(nld);
            setRightDirty(nrd);
            setLeftStat(nls);
            setRightStat(nrs);
            setDiffLines(computeDiff(nlc.split("\n"), nrc.split("\n")));
            setTableKey((k) => k + 1);
          }}
          data-tooltip="Swap Sides (preserves unsaved changes)"
        >
          ⇄
        </button>
        <button className="icon-btn" onClick={handleCompare} data-tooltip="Recompare (⌘R)">
          ↻
        </button>
        <button className="icon-btn" onClick={handleUndo} data-tooltip="Undo last edit (⌘Z)" disabled={undoStackRef.current.length === 0}>
          ↩
        </button>
        <div className="toolbar-sep" />
        <button className="icon-btn" onClick={goPrev} data-tooltip="Previous Diff (⇧F3)" disabled={diffCount === 0}>
          ↑
        </button>
        <button className="icon-btn" onClick={goNext} data-tooltip="Next Diff (F3)" disabled={diffCount === 0}>
          ↓
        </button>
        <div className="toolbar-sep" />
        <button className="icon-btn" onClick={handleCopyLeftToRight} data-tooltip="Copy All Left → Right (stages, no save)">
          →
        </button>
        <button className="icon-btn" onClick={handleCopyRightToLeft} data-tooltip="Copy All Right → Left (stages, no save)">
          ←
        </button>
        <div className="toolbar-sep" />
        <button
          className="icon-btn"
          onClick={() => setSyntaxOn((v) => !v)}
          style={{ color: syntaxOn ? "var(--accent)" : undefined }}
          data-tooltip={syntaxOn ? "Disable Syntax Highlight" : "Enable Syntax Highlight"}
        >
          ✨
        </button>
        {isBinary && <span className="fd-binary-badge">Binary</span>}
        {diffCount > 0 && <span className="fd-stats">{diffCount} differences</span>}
        {selectedRows.size > 0 && (
          <>
            <div className="toolbar-sep" />
            <span className="fd-sel-count">{selectedRows.size} selected</span>
            <button className="icon-btn" onClick={copySelectedToRight} data-tooltip="Copy selected lines → Right">
              →sel
            </button>
            <button className="icon-btn" onClick={copySelectedToLeft} data-tooltip="Copy selected lines ← Left">
              ←sel
            </button>
            <button className="icon-btn" onClick={() => setSelectedRows(new Set())} data-tooltip="Clear selection">
              ✕
            </button>
          </>
        )}
      </div>

      {/* Path bar */}
      <div className="fd-path-bar">
        <div className="fd-path-group">
          <input
            type="text"
            value={leftPath}
            onChange={(e) => setLeftPath(e.target.value)}
            placeholder="Left file…"
            className="fd-path-input"
          />
          {leftDirty && (
            <span className="fd-dirty-indicator" title="Unsaved changes">
              *
            </span>
          )}
          <button className="icon-btn" onClick={handleSelectLeft} data-tooltip="Browse">
            📂
          </button>
          <button
            className={`icon-btn fd-save-btn${leftDirty ? " fd-save-active" : ""}`}
            onClick={handleSaveLeft}
            disabled={!leftDirty}
            data-tooltip="Save Left"
          >
            💾
          </button>
        </div>
        <div className="fd-path-group">
          <input
            type="text"
            value={rightPath}
            onChange={(e) => setRightPath(e.target.value)}
            placeholder="Right file…"
            className="fd-path-input"
          />
          {rightDirty && (
            <span className="fd-dirty-indicator" title="Unsaved changes">
              *
            </span>
          )}
          <button className="icon-btn" onClick={handleSelectRight} data-tooltip="Browse">
            📂
          </button>
          <button
            className={`icon-btn fd-save-btn${rightDirty ? " fd-save-active" : ""}`}
            onClick={handleSaveRight}
            disabled={!rightDirty}
            data-tooltip="Save Right"
          >
            💾
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="fd-content">
        {loading && <div className="fd-loading">Loading…</div>}
        {error && <div className="fd-error">{error}</div>}
        {largeFileInfo && !loading && (
          <div className="fd-large-file-banner">
            ⚠ Large file — showing first {LARGE_FILE_MAX_LINES.toLocaleString()} lines per side.
            {(largeFileInfo.leftTruncated || largeFileInfo.rightTruncated) && (
              <span>
                {" "}
                {[largeFileInfo.leftTruncated && "Left", largeFileInfo.rightTruncated && "Right"].filter(Boolean).join(" & ")} truncated.
                Edits and saves apply to the loaded portion only.
              </span>
            )}
          </div>
        )}

        {!loading && !error && isBinary && <HexDiffView leftPath={leftPath} rightPath={rightPath} />}

        {!loading && !error && !isBinary && diffLines.length === 0 && !leftContent && (
          <div className="fd-placeholder">Enter file paths and click Recompare ↻</div>
        )}

        {!loading && !error && !isBinary && diffLines.length > 0 && (
          <div className="fd-diff-container">
            <ThumbnailStrip data={thumbnailData} />

            <div
              className="fd-diff-scroll"
              ref={scrollRef}
              onMouseUp={() => {
                dragSelectRef.current = null;
              }}
              onMouseMove={(e) => {
                if (!dragSelectRef.current?.active || e.buttons === 0) {
                  if (e.buttons === 0 && dragSelectRef.current) dragSelectRef.current = null;
                  return;
                }
                const target = document.elementFromPoint(e.clientX, e.clientY);
                const rowEl = (target as Element)?.closest("[data-row-idx]");
                if (!rowEl) return;
                const rowIdx = parseInt((rowEl as HTMLElement).dataset.rowIdx ?? "-1");
                if (rowIdx < 0) return;
                const startIdx = dragSelectRef.current.startIdx;
                const from = Math.min(startIdx, rowIdx);
                const to = Math.max(startIdx, rowIdx);
                setSelectedRows(
                  new Set(Array.from({ length: to - from + 1 }, (_, k) => from + k).filter((idx) => diffLines[idx]?.type !== "equal")),
                );
              }}
            >
              <div ref={tableDivRef} className={"fd-diff-table" + (isOrphanMode ? " fd-orphan-mode" : "")} key={tableKey}>
                {diffLines.map((line, i) => {
                  const isModified = line.type === "modified" || line.type === "whitespace";
                  const isWhitespace = line.type === "whitespace";
                  const canEditLeft = line.type !== "added";
                  const canEditRight = line.type !== "removed";
                  // Group copy: only show at the first row of each group
                  const gi = rowGroupIdx[i];
                  const isGroupFirst = gi >= 0 && groups[gi][0] === i;
                  const isGroupLast = gi >= 0 && groups[gi][groups[gi].length - 1] === i;
                  // Pre-compute bracket class (avoids > in JSX template literal attrs)
                  const isInBlock = gi >= 0 && groups[gi].length > 1;
                  const bracketClass = isInBlock
                    ? isGroupFirst
                      ? " fd-bracket-top"
                      : isGroupLast
                        ? " fd-bracket-bot"
                        : " fd-bracket-mid"
                    : "";

                  // Build HTML for a cell, handling whitespace-visible chars in whitespace-type rows
                  const renderCellHtml = (text: string, spans: typeof line.leftSpans, isLeft: boolean) => {
                    // While the user is actively typing in this cell, return plain escaped text.
                    // Using `text` (= line.leftText/rightText, stable within a render cycle) rather
                    // than editingCellRef.current.text means React sees the same __html string as
                    // the previous render → skips the DOM update → cursor position is preserved.
                    if (
                      editingCellRef.current &&
                      editingCellRef.current.idx === i &&
                      editingCellRef.current.side === (isLeft ? "left" : "right")
                    ) {
                      return escapeHtml(text);
                    }
                    if (isWhitespace && spans) {
                      return spans
                        .map((s) => {
                          const safe = escapeHtml(s.text)
                            .replace(/ /g, '<span class="fd-ws-dot">·</span>')
                            .replace(/\t/g, '<span class="fd-ws-dot">→</span>');
                          return s.changed ? `<mark class="fd-char-ws">${safe}</mark>` : safe;
                        })
                        .join("");
                    }
                    if (isModified && spans) {
                      return spans
                        .map((s) =>
                          s.changed
                            ? `<mark class="${isLeft ? "fd-char-del" : "fd-char-ins"}">${escapeHtml(s.text)}</mark>`
                            : escapeHtml(s.text),
                        )
                        .join("");
                    }
                    return syntaxOn && text ? highlightLine(text, lang) : escapeHtml(text);
                  };

                  const isRowSelected = selectedRows.has(i);

                  return (
                    <div
                      key={i}
                      id={`diff-row-${i}`}
                      data-row-idx={i}
                      className={`fd-diff-row fd-diff-${line.type}${i === currentDiffIdx ? " fd-diff-active" : ""}${isGroupFirst ? " fd-group-first" : ""}${isGroupLast ? " fd-group-last" : ""}${isRowSelected ? " fd-row-selected" : ""}`}
                      onMouseDown={(e) => {
                        // Clicks inside a text cell start native text selection — don't activate row-drag-select.
                        if ((e.target as Element).closest(".fd-line-text")) return;
                        if (line.type === "equal") return;
                        e.preventDefault();
                        dragSelectRef.current = { active: true, startIdx: i };
                        setSelectedRows(new Set([i]));
                        lastClickedRowRef.current = i;
                      }}
                    >
                      {/* Left line number — click to select/deselect this row */}
                      <span
                        className={"fd-line-no" + (isRowSelected ? " fd-line-no-sel" : "")}
                        onClick={line.type !== "equal" ? (e) => handleRowLineNoClick(i, e) : undefined}
                        title={line.type !== "equal" ? "Click to select (Shift+click for range)" : undefined}
                      >
                        {line.leftLineNo ?? ""}
                      </span>

                      {/* Left text — double-click to edit; plain div otherwise so native multi-row selection works */}
                      <div
                        key={`${tableKey}-${i}-l`}
                        id={`cell-${i}-l`}
                        className={`fd-line-text fd-line-left${isModified ? " fd-line-modified-left" : ""}${activeEditCell?.idx === i && activeEditCell?.side === "left" ? " fd-cell-editing" : ""}`}
                        contentEditable={
                          canEditLeft && activeEditCell?.idx === i && activeEditCell?.side === "left" ? "plaintext-only" : undefined
                        }
                        suppressContentEditableWarning
                        spellCheck={false}
                        title={canEditLeft && !(activeEditCell?.idx === i && activeEditCell?.side === "left") ? "Click to edit" : undefined}
                        onMouseDown={(e) => {
                          mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
                        }}
                        onMouseEnter={(e) => {
                          if (e.buttons === 0) startTextSelect("left");
                        }}
                        onClick={
                          canEditLeft
                            ? () => {
                                // Only activate editing if this was a plain click, not a drag selection.
                                const sel = window.getSelection();
                                if (!sel || sel.isCollapsed) setActiveEditCell({ idx: i, side: "left" });
                              }
                            : undefined
                        }
                        onFocus={
                          canEditLeft
                            ? () => {
                                editingCellRef.current = { idx: i, side: "left", text: line.leftText };
                              }
                            : undefined
                        }
                        onInput={
                          canEditLeft
                            ? (e) => {
                                // Only track the text in the ref; do NOT trigger any state update
                                // during typing — that would cause React to replace innerHTML and
                                // reset the cursor position.
                                if (editingCellRef.current) editingCellRef.current.text = e.currentTarget.textContent ?? "";
                              }
                            : undefined
                        }
                        onBlur={
                          canEditLeft
                            ? (e) => {
                                const newText = e.currentTarget.textContent ?? "";
                                editingCellRef.current = null;
                                if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
                                setActiveEditCell(null);
                                if (newText !== line.leftText) handleInlineEdit("left", i, newText);
                              }
                            : undefined
                        }
                        dangerouslySetInnerHTML={{ __html: renderCellHtml(line.leftText, line.leftSpans, true) }}
                      />

                      {/* Copy-to-right: bracket visual for blocks; single arrow for lone diff lines */}
                      <div className={"fd-copy-col" + bracketClass}>
                        {line.type !== "equal" && !isInBlock && (
                          <button
                            className="fd-line-copy fd-line-copy-right"
                            onClick={() => copyLineToRight(i)}
                            title="Copy this line to right"
                            tabIndex={-1}
                          >
                            ›
                          </button>
                        )}
                        {isGroupFirst && isInBlock && (
                          <button
                            className="fd-group-copy fd-group-copy-right"
                            onClick={() => copyGroupToRight(gi)}
                            title={"Copy " + groups[gi].length + " lines to right"}
                            tabIndex={-1}
                          >
                            »
                          </button>
                        )}
                      </div>

                      <span className="fd-gutter" />

                      {/* Copy-to-left: bracket visual for blocks; single arrow for lone diff lines */}
                      <div className={"fd-copy-col fd-copy-col-left" + bracketClass}>
                        {isGroupFirst && isInBlock && (
                          <button
                            className="fd-group-copy fd-group-copy-left"
                            onClick={() => copyGroupToLeft(gi)}
                            title={"Copy " + groups[gi].length + " lines to left"}
                            tabIndex={-1}
                          >
                            «
                          </button>
                        )}
                        {line.type !== "equal" && !isInBlock && (
                          <button
                            className="fd-line-copy fd-line-copy-left"
                            onClick={() => copyLineToLeft(i)}
                            title="← Copy this line to left"
                            tabIndex={-1}
                          >
                            ‹
                          </button>
                        )}
                      </div>

                      {/* Right line number — click to select/deselect this row */}
                      <span
                        className={"fd-line-no" + (isRowSelected ? " fd-line-no-sel" : "")}
                        onClick={line.type !== "equal" ? (e) => handleRowLineNoClick(i, e) : undefined}
                        title={line.type !== "equal" ? "Click to select (Shift+click for range)" : undefined}
                      >
                        {line.rightLineNo ?? ""}
                      </span>

                      {/* Right text — double-click to edit; plain div otherwise so native multi-row selection works */}
                      <div
                        key={`${tableKey}-${i}-r`}
                        id={`cell-${i}-r`}
                        className={`fd-line-text fd-line-right${isModified ? " fd-line-modified-right" : ""}${activeEditCell?.idx === i && activeEditCell?.side === "right" ? " fd-cell-editing" : ""}`}
                        contentEditable={
                          canEditRight && activeEditCell?.idx === i && activeEditCell?.side === "right" ? "plaintext-only" : undefined
                        }
                        suppressContentEditableWarning
                        spellCheck={false}
                        title={
                          canEditRight && !(activeEditCell?.idx === i && activeEditCell?.side === "right") ? "Click to edit" : undefined
                        }
                        onMouseDown={(e) => {
                          mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
                        }}
                        onMouseEnter={(e) => {
                          if (e.buttons === 0) startTextSelect("right");
                        }}
                        onClick={
                          canEditRight
                            ? () => {
                                const sel = window.getSelection();
                                if (!sel || sel.isCollapsed) setActiveEditCell({ idx: i, side: "right" });
                              }
                            : undefined
                        }
                        onFocus={
                          canEditRight
                            ? () => {
                                editingCellRef.current = { idx: i, side: "right", text: line.rightText };
                              }
                            : undefined
                        }
                        onInput={
                          canEditRight
                            ? (e) => {
                                if (editingCellRef.current) editingCellRef.current.text = e.currentTarget.textContent ?? "";
                              }
                            : undefined
                        }
                        onBlur={
                          canEditRight
                            ? (e) => {
                                const newText = e.currentTarget.textContent ?? "";
                                editingCellRef.current = null;
                                if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
                                setActiveEditCell(null);
                                if (newText !== line.rightText) handleInlineEdit("right", i, newText);
                              }
                            : undefined
                        }
                        dangerouslySetInnerHTML={{ __html: renderCellHtml(line.rightText, line.rightSpans, false) }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <ThumbnailStrip data={thumbnailData} />
          </div>
        )}
      </div>

      {/* Footbar — file metadata */}
      {(leftContent || rightContent) && (
        <div className="fd-footbar">
          <div className="fd-foot-side">
            {leftStat ? (
              <>
                <span>{formatSize(leftStat.size)}</span>
                <span className="fd-foot-sep">·</span>
                <span>{leftContent.split("\n").length} lines</span>
                <span className="fd-foot-sep">·</span>
                <span title="Modified">{formatDate(leftStat.mtime)}</span>
                {leftStat.birthtime !== leftStat.mtime && (
                  <span title={`Created ${formatDate(leftStat.birthtime)}`} className="fd-foot-muted">
                    {" "}
                    ({formatDate(leftStat.birthtime)} created)
                  </span>
                )}
                {leftStat.readonly && <span className="fd-foot-badge">RO</span>}
                {leftStat.hidden && <span className="fd-foot-badge">Hidden</span>}
              </>
            ) : (
              <span className="fd-foot-muted">{leftContent.split("\n").length} lines</span>
            )}
          </div>
          <div className="fd-foot-center">
            {diffCount === 0 ? (
              <span className="fd-foot-identical">Identical</span>
            ) : (
              <span>
                {diffCount} difference{diffCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="fd-foot-side fd-foot-right">
            {rightStat ? (
              <>
                {rightStat.readonly && <span className="fd-foot-badge">RO</span>}
                {rightStat.hidden && <span className="fd-foot-badge">Hidden</span>}
                <span title="Modified">{formatDate(rightStat.mtime)}</span>
                <span className="fd-foot-sep">·</span>
                <span>{rightContent.split("\n").length} lines</span>
                <span className="fd-foot-sep">·</span>
                <span>{formatSize(rightStat.size)}</span>
              </>
            ) : (
              <span className="fd-foot-muted">{rightContent.split("\n").length} lines</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
