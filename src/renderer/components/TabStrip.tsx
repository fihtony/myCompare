import React, { useRef, useState, useEffect } from "react";
import { useSessionStore } from "../store/session-store";
import { _dirtyFileSessions } from "./FileDiffView";
import { log } from "../../shared/logger";
import "./TabStrip.css";

export default function TabStrip() {
  const { sessions, activeSessionId, setActiveSession, closeSession } = useSessionStore();
  const [showNewMenu, setShowNewMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss the "+" menu when clicking outside
  useEffect(() => {
    if (!showNewMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNewMenu]);

  const handleNewSession = (type: "folder" | "file" | "git") => {
    log("UI", `User action: Creating new ${type} session via + button`);
    setShowNewMenu(false);
    const store = useSessionStore.getState();
    try {
      if (type === "folder") {
        const id = store.createFolderSession("", "");
        log("UI", `✓ Folder session created: ${id}`);
      } else if (type === "file") {
        const id = store.createFileSession("", "");
        log("UI", `✓ File session created: ${id}`);
      } else {
        const id = store.createGitSession("", "", "");
        log("UI", `✓ Git session created: ${id}`);
      }
    } catch (err: any) {
      log("UI", `✗ Error creating session: ${err.message}`);
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "folder":
        return "📁";
      case "file":
        return "📄";
      case "git":
        return "🔀";
      default:
        return "📋";
    }
  };

  return (
    <div className="tab-strip no-drag">
      <div className="tab-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`tab-item ${s.id === activeSessionId ? "active" : ""}`}
            onClick={() => setActiveSession(s.id)}
            title={s.name}
          >
            <span className="tab-icon">{typeIcon(s.type)}</span>
            <span className="tab-label">{s.name || "New Session"}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                if (_dirtyFileSessions.has(s.id)) {
                  const ok = window.confirm("This tab has unsaved changes. Close without saving?");
                  if (!ok) return;
                }
                closeSession(s.id);
              }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tab-actions" ref={menuRef}>
        <button
          className="icon-btn tab-new-btn"
          onClick={() => {
            log("UI", `User action: Clicked + button, menu ${!showNewMenu ? "opening" : "closing"}`);
            setShowNewMenu(!showNewMenu);
          }}
          data-tooltip="New Session (⌘T)"
        >
          +
        </button>
        {showNewMenu && (
          <div className="new-session-menu">
            <div onClick={() => handleNewSession("folder")}>📁 Folder Compare</div>
            <div onClick={() => handleNewSession("file")}>📄 File Compare</div>
            <div onClick={() => handleNewSession("git")}>🔀 Git Compare</div>
          </div>
        )}
      </div>
    </div>
  );
}
