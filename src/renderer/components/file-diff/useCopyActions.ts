/**
 * Hook encapsulating all copy/paste line operations:
 * copy-all, copy-single-line, copy-group (block), copy-selected.
 */
import { useCallback } from "react";
import { computeDiff } from "../../utils/diff";
import { reconstructLeft, reconstructRight } from "./utils";
import type { FileDiffState } from "./useFileDiffState";

export function useCopyActions(state: FileDiffState, groups: number[][], pushUndo: () => void) {
  const {
    leftContent,
    setLeftContent,
    rightContent,
    setRightContent,
    diffLines,
    setDiffLines,
    setTableKey,
    setLeftDirty,
    setRightDirty,
    selectedRows,
    setSelectedRows,
  } = state;

  /** Stage all left content into right (no disk write). */
  const handleCopyLeftToRight = useCallback(() => {
    pushUndo();
    setRightContent(leftContent);
    setRightDirty(true);
    setDiffLines(computeDiff(leftContent.split("\n"), leftContent.split("\n")));
  }, [leftContent, pushUndo, setRightContent, setRightDirty, setDiffLines]);

  /** Stage all right content into left (no disk write). */
  const handleCopyRightToLeft = useCallback(() => {
    pushUndo();
    setLeftContent(rightContent);
    setLeftDirty(true);
    setDiffLines(computeDiff(rightContent.split("\n"), rightContent.split("\n")));
  }, [rightContent, pushUndo, setLeftContent, setLeftDirty, setDiffLines]);

  /** Copy a single diff line's left text to the right side. */
  const copyLineToRight = useCallback(
    (idx: number) => {
      pushUndo();
      const newLines = diffLines.map((d, i) => (i === idx ? { ...d, type: "equal" as const, rightText: d.leftText } : d));
      setDiffLines(newLines);
      setRightContent(reconstructRight(newLines));
      setRightDirty(true);
      setSelectedRows(new Set());
    },
    [diffLines, pushUndo, setDiffLines, setRightContent, setRightDirty, setSelectedRows],
  );

  /** Copy a single diff line's right text to the left side. */
  const copyLineToLeft = useCallback(
    (idx: number) => {
      pushUndo();
      const newLines = diffLines.map((d, i) => (i === idx ? { ...d, type: "equal" as const, leftText: d.rightText } : d));
      setDiffLines(newLines);
      setLeftContent(reconstructLeft(newLines));
      setLeftDirty(true);
      setSelectedRows(new Set());
    },
    [diffLines, pushUndo, setDiffLines, setLeftContent, setLeftDirty, setSelectedRows],
  );

  /** Copy an entire contiguous diff group to the right side. */
  const copyGroupToRight = useCallback(
    (groupIdx: number) => {
      pushUndo();
      const groupSet = new Set(groups[groupIdx]);
      const newRight: string[] = [];
      for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];
        if (!groupSet.has(i)) {
          if (line.type !== "removed") newRight.push(line.rightText);
        } else {
          if (line.type === "removed") newRight.push(line.leftText);
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
    },
    [diffLines, leftContent, groups, pushUndo, setRightContent, setRightDirty, setDiffLines, setTableKey, setSelectedRows],
  );

  /** Copy an entire contiguous diff group to the left side. */
  const copyGroupToLeft = useCallback(
    (groupIdx: number) => {
      pushUndo();
      const groupSet = new Set(groups[groupIdx]);
      const newLeft: string[] = [];
      for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];
        if (!groupSet.has(i)) {
          if (line.type !== "added") newLeft.push(line.leftText);
        } else {
          if (line.type === "added") newLeft.push(line.rightText);
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
    },
    [diffLines, rightContent, groups, pushUndo, setLeftContent, setLeftDirty, setDiffLines, setTableKey, setSelectedRows],
  );

  /** Copy all currently-selected rows to the right side. */
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
        if (!sel) newRight.push(line.rightText);
      } else if (line.type === "removed") {
        if (sel) newRight.push(line.leftText);
      } else {
        newRight.push(sel ? line.leftText : line.rightText);
      }
    }
    const newRc = newRight.join("\n");
    setRightContent(newRc);
    setRightDirty(true);
    setDiffLines(computeDiff(leftContent.split("\n"), newRc.split("\n")));
    setTableKey((k) => k + 1);
    setSelectedRows(new Set());
  }, [diffLines, leftContent, selectedRows, pushUndo, setRightContent, setRightDirty, setDiffLines, setTableKey, setSelectedRows]);

  /** Copy all currently-selected rows to the left side. */
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
  }, [diffLines, rightContent, selectedRows, pushUndo, setLeftContent, setLeftDirty, setDiffLines, setTableKey, setSelectedRows]);

  /** Toggle single-row selection; Shift+click extends range. */
  const handleRowLineNoClick = useCallback(
    (idx: number, e: React.MouseEvent, diffLinesSnapshot: typeof diffLines) => {
      e.stopPropagation();
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && state.lastClickedRowRef.current !== null) {
          const from = Math.min(state.lastClickedRowRef.current, idx);
          const to = Math.max(state.lastClickedRowRef.current, idx);
          for (let j = from; j <= to; j++) {
            if (diffLinesSnapshot[j]?.type !== "equal") next.add(j);
          }
        } else {
          if (next.has(idx)) next.delete(idx);
          else next.add(idx);
          state.lastClickedRowRef.current = idx;
        }
        return next;
      });
    },
    [state.lastClickedRowRef, setSelectedRows],
  );

  return {
    handleCopyLeftToRight,
    handleCopyRightToLeft,
    copyLineToRight,
    copyLineToLeft,
    copyGroupToRight,
    copyGroupToLeft,
    copySelectedToRight,
    copySelectedToLeft,
    handleRowLineNoClick,
  };
}
