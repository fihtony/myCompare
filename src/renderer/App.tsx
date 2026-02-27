import React, { useEffect, useState } from "react";
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

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("app-theme") as "dark" | "light") || "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app-theme", theme);
    // Notify main process of theme change
    console.log("[App] Theme changed to:", theme);
    if (window.electronAPI && typeof window.electronAPI.notifyThemeChanged === "function") {
      console.log("[App] Calling notifyThemeChanged with:", theme);
      window.electronAPI.notifyThemeChanged(theme);
    } else {
      console.log("[App] notifyThemeChanged not available");
    }
  }, [theme]);

  useDropZone();
  useKeyboardShortcuts();

  useEffect(() => {
    // Apply persisted theme before first render
    document.documentElement.setAttribute("data-theme", theme);
    // Notify main process of current theme on init
    if (window.electronAPI && typeof window.electronAPI.notifyThemeChanged === "function") {
      window.electronAPI.notifyThemeChanged(theme);
    }
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
        <span className="app-title no-drag">myCompare</span>
        <button
          className="icon-btn app-theme-btn no-drag"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          data-tooltip={theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme"}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>
      <TabStrip />
      <div className="app-content">{activeSession ? <SessionContent session={activeSession} /> : <EmptyState />}</div>
    </div>
  );
}
