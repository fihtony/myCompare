import React from "react";
import { useDraggingState } from "../hooks/useDropZone";
import "./EmptyState.css";

export default function EmptyState() {
  const isDragging = useDraggingState();

  return (
    <div className={`empty-state ${isDragging ? "empty-state--dragging" : ""}`}>
      {isDragging ? (
        <div className="drag-overlay">
          <div className="drag-overlay-icon">⇩</div>
          <p>Drop files or folders here</p>
          <p className="drag-overlay-hint">Drop 2 items to compare, 1 item to fill one side</p>
        </div>
      ) : (
        <>
          <div className="empty-icon">⇆</div>
          <h2>Welcome to MaCompare</h2>
          <p>Drop two files or two folders here to start comparing</p>
          <p className="empty-hint">
            Or click <strong>+</strong> in the tab bar to create a new session
          </p>
          <div className="empty-drop-zone">
            <div className="drop-illustration">
              <span>📁</span>
              <span className="drop-arrow">↔</span>
              <span>📁</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
