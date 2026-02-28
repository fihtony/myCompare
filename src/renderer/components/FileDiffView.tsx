/**
 * FileDiffView — pure compositor (~200 lines).
 * All logic lives in file-diff/ sub-module hooks.
 */
import React, { useMemo, useEffect } from "react";
import type { FileSession } from "@shared/types";
import { useSessionStore } from "../store/session-store";
import { computeDiff, detectLanguage } from "../utils/diff";
import HexDiffView from "./HexDiffView";
import "highlight.js/styles/atom-one-dark.css";
import "./FileDiffView.css";

// Sub-module
import { useFileDiffState } from "./file-diff/useFileDiffState";
import { useFileLoader, LARGE_FILE_MAX_LINES } from "./file-diff/useFileLoader";
import { useEditActions } from "./file-diff/useEditActions";
import { useCopyActions } from "./file-diff/useCopyActions";
import { useClipboard } from "./file-diff/useClipboard";
import { useSyncScroll } from "./file-diff/useSyncScroll";
import { escapeHtml, highlightLine } from "./file-diff/utils";
import ThumbnailStrip from "./file-diff/ThumbnailStrip";
import DiffToolbar from "./file-diff/DiffToolbar";
import DiffPathBar from "./file-diff/DiffPathBar";
import DiffFootbar from "./file-diff/DiffFootbar";

interface Props {
  session: FileSession;
}

export const _dirtyFileSessions = new Set<string>();

export default function FileDiffView({ session }: Props) {
  const { updateSession } = useSessionStore();

  const state = useFileDiffState({ leftPath: session.leftPath, rightPath: session.rightPath });
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
    tableKey,
    setTableKey,
    loading,
    error,
    currentDiffIdx,
    setCurrentDiffIdx,
    isBinary,
    syntaxOn,
    setSyntaxOn,
    leftDirty,
    setLeftDirty,
    rightDirty,
    setRightDirty,
    leftStat,
    rightStat,
    largeFileInfo,
    selectedRows,
    setSelectedRows,
    activeEditCell,
    setActiveEditCell,
    undoStackRef,
    editingCellRef,
    mouseDownPosRef,
    dragSelectRef,
    lastClickedRowRef,
    tableDivRef,
  } = state;

  const { loadAndCompare, handleSelectLeft, handleSelectRight } = useFileLoader(state);
  const editActions = useEditActions(state, session);
  const { pushUndo, handleUndo, handleInlineEdit, handleSaveLeft, handleSaveRight } = editActions;

  const { groups, rowGroupIdx } = useMemo(() => {
    const gs: number[][] = [];
    const rgi = new Array<number>(diffLines.length).fill(-1);
    let i = 0;
    while (i < diffLines.length) {
      if (diffLines[i].type !== "equal") {
        const gi = gs.length;
        const idx: number[] = [];
        while (i < diffLines.length && diffLines[i].type !== "equal") {
          idx.push(i);
          rgi[i] = gi;
          i++;
        }
        gs.push(idx);
      } else {
        i++;
      }
    }
    return { groups: gs, rowGroupIdx: rgi };
  }, [diffLines]);

  const copyActions = useCopyActions(state, groups, pushUndo);
  const {
    handleCopyLeftToRight,
    handleCopyRightToLeft,
    copyLineToRight,
    copyLineToLeft,
    copyGroupToRight,
    copyGroupToLeft,
    copySelectedToRight,
    copySelectedToLeft,
    handleRowLineNoClick,
  } = copyActions;

  const { startTextSelect } = useClipboard(tableDivRef);
  const { leftPaneRef, centerPaneRef, rightPaneRef, onLeftScroll, onRightScroll } = useSyncScroll();

  const isOrphanMode = !leftPath || !rightPath;
  const lang = useMemo(() => detectLanguage(leftPath || rightPath), [leftPath, rightPath]);
  const diffIndices = diffLines.map((d, i) => (d.type !== "equal" ? i : -1)).filter((i) => i >= 0);
  const diffCount = diffIndices.length;

  const thumbnailData = diffLines.map((d) => {
    if (d.type === "added") return "var(--diff-added-line)";
    if (d.type === "removed") return "var(--diff-removed-line)";
    if (d.type === "modified") return "var(--diff-modified-line)";
    if (d.type === "whitespace") return "var(--diff-whitespace-line, #5b8dd9)";
    return "transparent";
  });

  useEffect(() => {
    if (session.leftPath || session.rightPath) {
      setLeftPath(session.leftPath);
      setRightPath(session.rightPath);
      loadAndCompare(session.leftPath, session.rightPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.leftPath, session.rightPath]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z")) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.contentEditable === "plaintext-only") {
        const ref = editingCellRef.current;
        const currentText = active.textContent ?? "";
        if (ref && currentText !== ref.originalText) return;
        active.blur();
      }
      e.preventDefault();
      handleUndo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleUndo]);

  useEffect(() => {
    if (leftDirty || rightDirty) _dirtyFileSessions.add(session.id);
    else _dirtyFileSessions.delete(session.id);
    return () => {
      _dirtyFileSessions.delete(session.id);
    };
  }, [leftDirty, rightDirty, session.id]);

  useEffect(() => {
    if (!activeEditCell) return;
    const id = `cell-${activeEditCell.idx}-${activeEditCell.side === "left" ? "l" : "r"}`;
    const timer = setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.focus();
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
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditCell]);

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

  const handleSwap = () => {
    const nl = rightPath,
      nr = leftPath,
      nlc = rightContent,
      nrc = leftContent;
    const nld = rightDirty,
      nrd = leftDirty,
      nls = state.rightStat,
      nrs = state.leftStat;
    setLeftPath(nl);
    setRightPath(nr);
    setLeftContent(nlc);
    setRightContent(nrc);
    setLeftDirty(nld);
    setRightDirty(nrd);
    state.setLeftStat(nls);
    state.setRightStat(nrs);
    setDiffLines(computeDiff(nlc.split("\n"), nrc.split("\n")));
    setTableKey((k: number) => k + 1);
  };

  const handleRecompare = () => {
    updateSession(session.id, { leftPath, rightPath } as any);
    updateSession(session.id, { name: leftPath.split("/").pop() || "File Compare" } as any);
    loadAndCompare(leftPath, rightPath);
  };

  const renderCellHtml = (
    lineIdx: number,
    text: string,
    spans: { text: string; changed: boolean }[] | undefined,
    isLeft: boolean,
    isModified: boolean,
    isWhitespace: boolean,
  ) => {
    if (editingCellRef.current?.idx === lineIdx && editingCellRef.current.side === (isLeft ? "left" : "right")) {
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
          s.changed ? `<mark class="${isLeft ? "fd-char-del" : "fd-char-ins"}">${escapeHtml(s.text)}</mark>` : escapeHtml(s.text),
        )
        .join("");
    }
    return syntaxOn && text ? highlightLine(text, lang) : escapeHtml(text);
  };

  return (
    <div className="file-diff">
      <DiffToolbar
        syntaxOn={syntaxOn}
        setSyntaxOn={setSyntaxOn}
        isBinary={isBinary}
        diffCount={diffCount}
        selectedRows={selectedRows}
        undoDisabled={undoStackRef.current.length === 0}
        onSwap={handleSwap}
        onRecompare={handleRecompare}
        onUndo={handleUndo}
        onPrev={goPrev}
        onNext={goNext}
        onCopyAllLeft={handleCopyLeftToRight}
        onCopyAllRight={handleCopyRightToLeft}
        onCopySelectedRight={copySelectedToRight}
        onCopySelectedLeft={copySelectedToLeft}
        onClearSelection={() => setSelectedRows(new Set())}
      />
      <DiffPathBar
        leftPath={leftPath}
        rightPath={rightPath}
        leftDirty={leftDirty}
        rightDirty={rightDirty}
        onLeftPathChange={setLeftPath}
        onRightPathChange={setRightPath}
        onRecompare={handleRecompare}
        onSelectLeft={() => handleSelectLeft(rightPath)}
        onSelectRight={() => handleSelectRight(leftPath)}
        onSaveLeft={handleSaveLeft}
        onSaveRight={handleSaveRight}
      />
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
              ref={tableDivRef}
              className={"fd-split-wrapper" + (isOrphanMode ? " fd-orphan-mode" : "")}
              onMouseUp={() => {
                dragSelectRef.current = null;
              }}
              onMouseMove={(e) => {
                if (!dragSelectRef.current?.active || e.buttons === 0) {
                  if (e.buttons === 0 && dragSelectRef.current) dragSelectRef.current = null;
                  return;
                }
                const rowEl = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest("[data-row-idx]");
                if (!rowEl) return;
                const rowIdx = parseInt((rowEl as HTMLElement).dataset.rowIdx ?? "-1");
                if (rowIdx < 0) return;
                const { startIdx } = dragSelectRef.current;
                setSelectedRows(
                  new Set(
                    Array.from({ length: Math.abs(rowIdx - startIdx) + 1 }, (_, k) => Math.min(startIdx, rowIdx) + k).filter(
                      (idx) => diffLines[idx]?.type !== "equal",
                    ),
                  ),
                );
              }}
            >
              {/* Left pane */}
              <div className="fd-left-pane" ref={leftPaneRef} onScroll={onLeftScroll}>
                <div className="fd-diff-table fd-left-table" key={tableKey}>
                  {diffLines.map((line, i) => {
                    const isModified = line.type === "modified" || line.type === "whitespace";
                    const isWhitespace = line.type === "whitespace";
                    const canEditLeft = line.type !== "added";
                    const gi = rowGroupIdx[i];
                    const isGroupFirst = gi >= 0 && groups[gi][0] === i;
                    const isGroupLast = gi >= 0 && groups[gi][groups[gi].length - 1] === i;
                    const isRowSelected = selectedRows.has(i);
                    return (
                      <div
                        key={i}
                        id={`diff-row-${i}`}
                        data-row-idx={i}
                        className={`fd-diff-row fd-diff-${line.type}${i === currentDiffIdx ? " fd-diff-active" : ""}${isGroupFirst ? " fd-group-first" : ""}${isGroupLast ? " fd-group-last" : ""}${isRowSelected ? " fd-row-selected" : ""}`}
                        onMouseDown={(e) => {
                          if ((e.target as Element).closest(".fd-line-text")) return;
                          if (line.type === "equal") return;
                          e.preventDefault();
                          dragSelectRef.current = { active: true, startIdx: i };
                          setSelectedRows(new Set([i]));
                          lastClickedRowRef.current = i;
                        }}
                      >
                        <span
                          className={"fd-line-no" + (isRowSelected ? " fd-line-no-sel" : "")}
                          onClick={line.type !== "equal" ? (e) => handleRowLineNoClick(i, e, diffLines) : undefined}
                          title={line.type !== "equal" ? "Click to select" : undefined}
                        >
                          {line.leftLineNo ?? ""}
                        </span>
                        <div
                          key={`${tableKey}-${i}-l`}
                          id={`cell-${i}-l`}
                          className={`fd-line-text fd-line-left${isModified ? " fd-line-modified-left" : ""}${activeEditCell?.idx === i && activeEditCell?.side === "left" ? " fd-cell-editing" : ""}`}
                          contentEditable={
                            canEditLeft && activeEditCell?.idx === i && activeEditCell?.side === "left"
                              ? ("plaintext-only" as any)
                              : undefined
                          }
                          suppressContentEditableWarning
                          spellCheck={false}
                          title={
                            canEditLeft && !(activeEditCell?.idx === i && activeEditCell?.side === "left") ? "Click to edit" : undefined
                          }
                          onMouseDown={(e) => {
                            mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
                            // Do NOT call removeAllRanges() here — clearing the
                            // selection anchor on mousedown prevents the browser
                            // from building a drag-selection.
                            startTextSelect("left");
                          }}
                          onClick={
                            canEditLeft
                              ? () => {
                                  const sel = window.getSelection();
                                  if (!sel || sel.isCollapsed) setActiveEditCell({ idx: i, side: "left" });
                                }
                              : undefined
                          }
                          onFocus={
                            canEditLeft
                              ? () => {
                                  editingCellRef.current = { idx: i, side: "left", text: line.leftText, originalText: line.leftText };
                                }
                              : undefined
                          }
                          onInput={
                            canEditLeft
                              ? (e) => {
                                  if (editingCellRef.current) editingCellRef.current.text = e.currentTarget.textContent ?? "";
                                }
                              : undefined
                          }
                          onBlur={
                            canEditLeft
                              ? (e) => {
                                  const newText = e.currentTarget.textContent ?? "";
                                  editingCellRef.current = null;
                                  setActiveEditCell(null);
                                  if (newText !== line.leftText) handleInlineEdit("left", i, newText);
                                }
                              : undefined
                          }
                          dangerouslySetInnerHTML={{
                            __html: renderCellHtml(i, line.leftText, line.leftSpans, true, isModified, isWhitespace),
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Center pane */}
              <div className="fd-center-pane" ref={centerPaneRef}>
                <div className="fd-center-table" key={tableKey}>
                  {diffLines.map((line, i) => {
                    const gi = rowGroupIdx[i];
                    const isGroupFirst = gi >= 0 && groups[gi][0] === i;
                    const isGroupLast = gi >= 0 && groups[gi][groups[gi].length - 1] === i;
                    const isInBlock = gi >= 0 && groups[gi].length > 1;
                    const bracketClass = isInBlock
                      ? isGroupFirst
                        ? " fd-bracket-top"
                        : isGroupLast
                          ? " fd-bracket-bot"
                          : " fd-bracket-mid"
                      : "";
                    return (
                      <div key={i} className={`fd-center-row fd-diff-${line.type}`}>
                        <div className={"fd-copy-col" + bracketClass}>
                          {line.type !== "equal" && !isInBlock && (
                            <button
                              className="fd-line-copy fd-line-copy-right"
                              onClick={() => copyLineToRight(i)}
                              title="Copy this line to right"
                              tabIndex={-1}
                            >
                              &rsaquo;
                            </button>
                          )}
                          {isGroupFirst && isInBlock && (
                            <button
                              className="fd-group-copy fd-group-copy-right"
                              onClick={() => copyGroupToRight(gi)}
                              title={"Copy " + groups[gi].length + " lines to right"}
                              tabIndex={-1}
                            >
                              &raquo;
                            </button>
                          )}
                        </div>
                        <span className="fd-gutter" />
                        <div className={"fd-copy-col fd-copy-col-left" + bracketClass}>
                          {isGroupFirst && isInBlock && (
                            <button
                              className="fd-group-copy fd-group-copy-left"
                              onClick={() => copyGroupToLeft(gi)}
                              title={"Copy " + groups[gi].length + " lines to left"}
                              tabIndex={-1}
                            >
                              &laquo;
                            </button>
                          )}
                          {line.type !== "equal" && !isInBlock && (
                            <button
                              className="fd-line-copy fd-line-copy-left"
                              onClick={() => copyLineToLeft(i)}
                              title="← Copy this line to left"
                              tabIndex={-1}
                            >
                              &lsaquo;
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Right pane */}
              <div className="fd-right-pane" ref={rightPaneRef} onScroll={onRightScroll}>
                <div className="fd-diff-table fd-right-table" key={tableKey}>
                  {diffLines.map((line, i) => {
                    const isModified = line.type === "modified" || line.type === "whitespace";
                    const isWhitespace = line.type === "whitespace";
                    const canEditRight = line.type !== "removed";
                    const gi = rowGroupIdx[i];
                    const isGroupFirst = gi >= 0 && groups[gi][0] === i;
                    const isGroupLast = gi >= 0 && groups[gi][groups[gi].length - 1] === i;
                    const isRowSelected = selectedRows.has(i);
                    return (
                      <div
                        key={i}
                        data-row-idx={i}
                        className={`fd-diff-row fd-diff-${line.type}${i === currentDiffIdx ? " fd-diff-active" : ""}${isGroupFirst ? " fd-group-first" : ""}${isGroupLast ? " fd-group-last" : ""}${isRowSelected ? " fd-row-selected" : ""}`}
                        onMouseDown={(e) => {
                          if ((e.target as Element).closest(".fd-line-text")) return;
                          if (line.type === "equal") return;
                          e.preventDefault();
                          dragSelectRef.current = { active: true, startIdx: i };
                          setSelectedRows(new Set([i]));
                          lastClickedRowRef.current = i;
                        }}
                      >
                        <span
                          className={"fd-line-no" + (isRowSelected ? " fd-line-no-sel" : "")}
                          onClick={line.type !== "equal" ? (e) => handleRowLineNoClick(i, e, diffLines) : undefined}
                          title={line.type !== "equal" ? "Click to select" : undefined}
                        >
                          {line.rightLineNo ?? ""}
                        </span>
                        <div
                          key={`${tableKey}-${i}-r`}
                          id={`cell-${i}-r`}
                          className={`fd-line-text fd-line-right${isModified ? " fd-line-modified-right" : ""}${activeEditCell?.idx === i && activeEditCell?.side === "right" ? " fd-cell-editing" : ""}`}
                          contentEditable={
                            canEditRight && activeEditCell?.idx === i && activeEditCell?.side === "right"
                              ? ("plaintext-only" as any)
                              : undefined
                          }
                          suppressContentEditableWarning
                          spellCheck={false}
                          title={
                            canEditRight && !(activeEditCell?.idx === i && activeEditCell?.side === "right") ? "Click to edit" : undefined
                          }
                          onMouseDown={(e) => {
                            mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
                            // Do NOT call removeAllRanges() here — clearing the
                            // selection anchor on mousedown prevents the browser
                            // from building a drag-selection.
                            startTextSelect("right");
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
                                  editingCellRef.current = { idx: i, side: "right", text: line.rightText, originalText: line.rightText };
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
                                  setActiveEditCell(null);
                                  if (newText !== line.rightText) handleInlineEdit("right", i, newText);
                                }
                              : undefined
                          }
                          dangerouslySetInnerHTML={{
                            __html: renderCellHtml(i, line.rightText, line.rightSpans, false, isModified, isWhitespace),
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <ThumbnailStrip data={thumbnailData} />
          </div>
        )}
      </div>
      <DiffFootbar leftContent={leftContent} rightContent={rightContent} leftStat={leftStat} rightStat={rightStat} diffCount={diffCount} />
    </div>
  );
}
