import React, { useEffect } from "react";
import { useSessionStore } from "./store/session-store";
import TabStrip from "./components/TabStrip";
import SessionContent from "./components/SessionContent";
import EmptyState from "./components/EmptyState";
import { useDropZone } from "./hooks/useDropZone";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { log } from "../shared/logger";
import "./styles/app.css";

export default function App() {
  const { sessions, activeSessionId, restore } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useDropZone();
  useKeyboardShortcuts();

  useEffect(() => {
    log("Renderer", "App initializing...");
    restore();
  }, []);

  // Auto-persist on session changes
  useEffect(() => {
    const store = useSessionStore.getState();
    if (sessions.length > 0) {
      log("Renderer", `Sessions restored from disk: ${sessions.length} session(s)`);
      store.persist();
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (activeSession) {
      log("Renderer", `Active session changed: ${activeSession.type} (${activeSession.id})`);
    }
  }, [activeSessionId]);

  return (
    <div className="app-container">
      <div className="app-titlebar drag-region">
        <span className="app-title no-drag">MaCompare</span>
      </div>
      <TabStrip />
      <div className="app-content">{activeSession ? <SessionContent session={activeSession} /> : <EmptyState />}</div>
    </div>
  );
}
