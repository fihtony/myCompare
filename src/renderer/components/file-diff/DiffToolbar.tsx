import React from "react";

interface Props {
  syntaxOn: boolean;
  setSyntaxOn: (v: (prev: boolean) => boolean) => void;
  isBinary: boolean;
  diffCount: number;
  selectedRows: Set<number>;
  undoDisabled: boolean;
  onSwap: () => void;
  onRecompare: () => void;
  onUndo: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCopyAllLeft: () => void;
  onCopyAllRight: () => void;
  onCopySelectedRight: () => void;
  onCopySelectedLeft: () => void;
  onClearSelection: () => void;
}

export default function DiffToolbar({
  syntaxOn,
  setSyntaxOn,
  isBinary,
  diffCount,
  selectedRows,
  undoDisabled,
  onSwap,
  onRecompare,
  onUndo,
  onPrev,
  onNext,
  onCopyAllLeft,
  onCopyAllRight,
  onCopySelectedRight,
  onCopySelectedLeft,
  onClearSelection,
}: Props) {
  return (
    <div className="fd-toolbar">
      <button className="icon-btn" onClick={onSwap} data-tooltip="Swap Sides (preserves unsaved changes)">
        ⇄
      </button>
      <button className="icon-btn" onClick={onRecompare} data-tooltip="Recompare (⌘R)">
        ↻
      </button>
      <button className="icon-btn" onClick={onUndo} data-tooltip="Undo last edit (⌘Z)" disabled={undoDisabled}>
        ↩
      </button>
      <div className="toolbar-sep" />
      <button className="icon-btn" onClick={onPrev} data-tooltip="Previous Diff (⇧F3)" disabled={diffCount === 0}>
        ↑
      </button>
      <button className="icon-btn" onClick={onNext} data-tooltip="Next Diff (F3)" disabled={diffCount === 0}>
        ↓
      </button>
      <div className="toolbar-sep" />
      <button className="icon-btn" onClick={onCopyAllLeft} data-tooltip="Copy All Left → Right (stages, no save)">
        →
      </button>
      <button className="icon-btn" onClick={onCopyAllRight} data-tooltip="Copy All Right → Left (stages, no save)">
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
          <button className="icon-btn" onClick={onCopySelectedRight} data-tooltip="Copy selected lines → Right">
            →sel
          </button>
          <button className="icon-btn" onClick={onCopySelectedLeft} data-tooltip="Copy selected lines ← Left">
            ←sel
          </button>
          <button className="icon-btn" onClick={onClearSelection} data-tooltip="Clear selection">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
