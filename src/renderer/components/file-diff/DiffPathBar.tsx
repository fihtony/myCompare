import React from "react";

interface Props {
  leftPath: string;
  rightPath: string;
  leftDirty: boolean;
  rightDirty: boolean;
  onLeftPathChange: (v: string) => void;
  onRightPathChange: (v: string) => void;
  onRecompare: () => void;
  onSelectLeft: () => void;
  onSelectRight: () => void;
  onSaveLeft: () => void;
  onSaveRight: () => void;
}

export default function DiffPathBar({
  leftPath,
  rightPath,
  leftDirty,
  rightDirty,
  onLeftPathChange,
  onRightPathChange,
  onRecompare,
  onSelectLeft,
  onSelectRight,
  onSaveLeft,
  onSaveRight,
}: Props) {
  return (
    <div className="fd-path-bar">
      <div className="fd-path-group">
        <input
          type="text"
          value={leftPath}
          onChange={(e) => onLeftPathChange(e.target.value)}
          onBlur={() => {
            if (leftPath && rightPath) onRecompare();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && leftPath && rightPath) onRecompare();
          }}
          placeholder="Left file…"
          className="fd-path-input"
        />
        {leftDirty && (
          <span className="fd-dirty-indicator" title="Unsaved changes">
            *
          </span>
        )}
        <button className="icon-btn" onClick={onSelectLeft} data-tooltip="Browse">
          📂
        </button>
        <button
          className={`icon-btn fd-save-btn${leftDirty ? " fd-save-active" : ""}`}
          onClick={onSaveLeft}
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
          onChange={(e) => onRightPathChange(e.target.value)}
          onBlur={() => {
            if (leftPath && rightPath) onRecompare();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && leftPath && rightPath) onRecompare();
          }}
          placeholder="Right file…"
          className="fd-path-input"
        />
        {rightDirty && (
          <span className="fd-dirty-indicator" title="Unsaved changes">
            *
          </span>
        )}
        <button className="icon-btn" onClick={onSelectRight} data-tooltip="Browse">
          📂
        </button>
        <button
          className={`icon-btn fd-save-btn${rightDirty ? " fd-save-active" : ""}`}
          onClick={onSaveRight}
          disabled={!rightDirty}
          data-tooltip="Save Right"
        >
          💾
        </button>
      </div>
    </div>
  );
}
