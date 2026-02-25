import { useEffect } from "react";
import { useSessionStore } from "../store/session-store";

/**
 * Global keyboard shortcuts for the application.
 * Cmd+T  → New folder compare session
 * Cmd+W  → Close active session
 * Cmd+R  → Refresh/recompare (handled by views)
 * Cmd+Z  → Reopen last closed session
 * F3     → Next diff (handled by views)
 * Shift+F3 → Previous diff (handled by views)
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+T → New folder session
      if (isMeta && e.key === "t") {
        e.preventDefault();
        const store = useSessionStore.getState();
        store.createFolderSession("", "");
        return;
      }

      // Cmd+W → Close active session
      if (isMeta && e.key === "w") {
        e.preventDefault();
        const store = useSessionStore.getState();
        if (store.activeSessionId) {
          store.closeSession(store.activeSessionId);
        }
        return;
      }

      // Cmd+Z → Reopen last closed
      if (isMeta && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        const store = useSessionStore.getState();
        store.reopenLastClosed();
        return;
      }

      // Cmd+1-9 → Switch to nth tab
      if (isMeta && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const store = useSessionStore.getState();
        const idx = parseInt(e.key) - 1;
        if (idx < store.sessions.length) {
          store.setActiveSession(store.sessions[idx].id);
        }
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
