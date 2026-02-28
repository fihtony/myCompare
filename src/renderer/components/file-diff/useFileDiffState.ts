/**
 * Central state container for FileDiffView.
 * Holds all useState / useRef declarations so they can be imported by action hooks.
 */
import { useState, useRef } from "react";
import type { FileStatInfo } from "@shared/types";
import type { DiffLine } from "../../utils/diff";
import type { ActiveEditCell, EditingCellInfo } from "./types";

export function useFileDiffState(initialSession: { leftPath: string; rightPath: string }) {
  // ── File contents & paths ────────────────────────────────────────────────
  const [leftContent, setLeftContent] = useState<string>("");
  const [rightContent, setRightContent] = useState<string>("");
  const [leftPath, setLeftPath] = useState(initialSession.leftPath);
  const [rightPath, setRightPath] = useState(initialSession.rightPath);

  // ── Diff state ────────────────────────────────────────────────────────────
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  /** Increment to force full remount of the diff table (resetting all cell keys). */
  const [tableKey, setTableKey] = useState(0);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDiffIdx, setCurrentDiffIdx] = useState(-1);
  const [isBinary, setIsBinary] = useState(false);
  const [syntaxOn, setSyntaxOn] = useState(true);
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [leftStat, setLeftStat] = useState<FileStatInfo | null>(null);
  const [rightStat, setRightStat] = useState<FileStatInfo | null>(null);
  const [largeFileInfo, setLargeFileInfo] = useState<{
    leftTruncated: boolean;
    rightTruncated: boolean;
  } | null>(null);

  // ── Row selection ────────────────────────────────────────────────────────
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // ── Inline editing ────────────────────────────────────────────────────────
  /**
   * Which cell is currently in edit mode. Only this cell gets
   * contentEditable="plaintext-only"; others are plain read-only divs.
   */
  const [activeEditCell, setActiveEditCell] = useState<ActiveEditCell | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  /** Undo stack: snapshots of {lc, rc} before each edit. Max 100 entries. */
  const undoStackRef = useRef<Array<{ lc: string; rc: string }>>([]);
  /** Original content loaded from disk — used to determine dirty state after undo. */
  const originalLeftContentRef = useRef<string>("");
  const originalRightContentRef = useRef<string>("");
  /** Tracks the user's live keystrokes to prevent React clobbering cursor. */
  const editingCellRef = useRef<EditingCellInfo | null>(null);
  /** Debounce timer for live diff recompute during typing. */
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mousedown coordinates for caret-restore after edit activation. */
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Last row index clicked (for Shift+click range extension). */
  const lastClickedRowRef = useRef<number | null>(null);
  /** Drag-select state (row drag via line-number area). */
  const dragSelectRef = useRef<{ active: boolean; startIdx: number } | null>(null);
  /** The fd-diff-table wrapper element — used by useClipboard. */
  const tableDivRef = useRef<HTMLDivElement>(null);

  return {
    // contents
    leftContent,
    setLeftContent,
    rightContent,
    setRightContent,
    leftPath,
    setLeftPath,
    rightPath,
    setRightPath,
    // diff
    diffLines,
    setDiffLines,
    tableKey,
    setTableKey,
    // ui
    loading,
    setLoading,
    error,
    setError,
    currentDiffIdx,
    setCurrentDiffIdx,
    isBinary,
    setIsBinary,
    syntaxOn,
    setSyntaxOn,
    leftDirty,
    setLeftDirty,
    rightDirty,
    setRightDirty,
    leftStat,
    setLeftStat,
    rightStat,
    setRightStat,
    largeFileInfo,
    setLargeFileInfo,
    // selection
    selectedRows,
    setSelectedRows,
    // editing
    activeEditCell,
    setActiveEditCell,
    // refs
    undoStackRef,
    originalLeftContentRef,
    originalRightContentRef,
    editingCellRef,
    inputTimerRef,
    mouseDownPosRef,
    lastClickedRowRef,
    dragSelectRef,
    tableDivRef,
  };
}

export type FileDiffState = ReturnType<typeof useFileDiffState>;
