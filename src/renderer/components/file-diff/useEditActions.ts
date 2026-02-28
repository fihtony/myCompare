/**
 * Hook encapsulating inline-editing, undo, and save-to-disk actions.
 */
import { useCallback } from "react";
import { computeDiff } from "../../utils/diff";
import { log, error as logError } from "../../../shared/logger";
import type { FileSession, FolderSession } from "@shared/types";
import { useSessionStore } from "../../store/session-store";
import { reconstructLeft, reconstructRight } from "./utils";
import type { FileDiffState } from "./useFileDiffState";

export function useEditActions(state: FileDiffState, session: FileSession) {
  const { sessions } = useSessionStore();
  const {
    leftContent,
    setLeftContent,
    rightContent,
    setRightContent,
    leftPath,
    setLeftPath,
    rightPath,
    setRightPath,
    diffLines,
    setDiffLines,
    setTableKey,
    setLeftDirty,
    setRightDirty,
    undoStackRef,
    originalLeftContentRef,
    originalRightContentRef,
    editingCellRef,
    inputTimerRef,
  } = state;

  /** Push a snapshot onto the undo stack before any mutation. */
  const pushUndo = useCallback(() => {
    undoStackRef.current.push({ lc: leftContent, rc: rightContent });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
  }, [leftContent, rightContent, undoStackRef]);

  /** Revert the last edit. */
  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    const { lc, rc } = prev;
    setLeftContent(lc);
    setRightContent(rc);
    setDiffLines(computeDiff(lc.split("\n"), rc.split("\n")));
    setTableKey((k) => k + 1);
    setLeftDirty(lc !== originalLeftContentRef.current);
    setRightDirty(rc !== originalRightContentRef.current);
  }, [
    undoStackRef,
    setLeftContent,
    setRightContent,
    setDiffLines,
    setTableKey,
    setLeftDirty,
    setRightDirty,
    originalLeftContentRef,
    originalRightContentRef,
  ]);

  /**
   * Commit an inline edit for one line and recompute the diff.
   * Resets tableKey so the entire table re-renders with fresh cell keys.
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
    [diffLines, pushUndo, setLeftContent, setRightContent, setDiffLines, setTableKey, setLeftDirty, setRightDirty],
  );

  /**
   * Soft inline edit: does NOT reset tableKey, so the active contentEditable
   * keeps focus and cursor position is preserved during live typing.
   */
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
    [diffLines, setLeftContent, setRightContent, setDiffLines, setLeftDirty, setRightDirty],
  );

  const handleSaveLeft = useCallback(async () => {
    try {
      let savePath = leftPath;
      if (!savePath) {
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
  }, [leftPath, rightPath, leftContent, session, sessions, setLeftPath, setLeftDirty]);

  const handleSaveRight = useCallback(async () => {
    try {
      let savePath = rightPath;
      if (!savePath) {
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
  }, [leftPath, rightPath, rightContent, session, sessions, setRightPath, setRightDirty]);

  return {
    pushUndo,
    handleUndo,
    handleInlineEdit,
    handleInlineEditSoft,
    handleSaveLeft,
    handleSaveRight,
  };
}
