import { create } from "zustand";
import type {
  Session,
  FolderSession,
  FileSession,
  GitSession,
  FilterMode,
  FolderCompareResult,
  GitCompareResult,
  PersistedState,
} from "@shared/types";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  closedSessionIds: string[];
  folderResults: Record<string, FolderCompareResult>;
  gitResults: Record<string, GitCompareResult>;

  // Session CRUD
  createFolderSession: (leftPath: string, rightPath: string) => string;
  createFileSession: (leftPath: string, rightPath: string, parentId?: string) => string;
  createGitSession: (repoPath: string, leftRef: string, rightRef: string) => string;
  closeSession: (id: string) => void;
  reopenLastClosed: () => void;
  setActiveSession: (id: string) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;

  // Filter
  setFilterMode: (id: string, mode: FilterMode) => void;
  setExcludePatterns: (id: string, patterns: string[]) => void;

  // Results
  setFolderResult: (sessionId: string, result: FolderCompareResult) => void;
  setGitResult: (sessionId: string, result: GitCompareResult) => void;

  // Persistence
  persist: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  closedSessionIds: [],
  folderResults: {},
  gitResults: {},

  createFolderSession: (leftPath, rightPath) => {
    const id = generateId();
    const leftName = leftPath.split("/").pop() || leftPath;
    const rightName = rightPath.split("/").pop() || rightPath;
    const session: FolderSession = {
      id,
      name: `${leftName} ↔ ${rightName}`,
      type: "folder",
      filterMode: "all",
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      leftPath,
      rightPath,
      excludePatterns: [],
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: id,
    }));
    return id;
  },

  createFileSession: (leftPath, rightPath, parentId) => {
    const id = generateId();
    const leftName = leftPath.split("/").pop() || leftPath;
    const session: FileSession = {
      id,
      name: leftName,
      type: "file",
      filterMode: "all",
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      leftPath,
      rightPath,
      parentSessionId: parentId,
      viewMode: "text",
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: id,
    }));
    return id;
  },

  createGitSession: (repoPath, leftRef, rightRef) => {
    const id = generateId();
    const repoName = repoPath.split("/").pop() || repoPath;
    const session: GitSession = {
      id,
      name: `${repoName} (${leftRef} ↔ ${rightRef})`,
      type: "git",
      filterMode: "all",
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      repoPath,
      leftRef,
      rightRef,
      excludePatterns: [],
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: id,
    }));
    return id;
  },

  closeSession: (id) => {
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === id);
      const newSessions = state.sessions.filter((s) => s.id !== id);
      let newActiveId = state.activeSessionId;
      if (state.activeSessionId === id) {
        if (newSessions.length > 0) {
          const nextIdx = Math.min(idx, newSessions.length - 1);
          newActiveId = newSessions[nextIdx].id;
        } else {
          newActiveId = null;
        }
      }
      const newFolderResults = { ...state.folderResults };
      delete newFolderResults[id];
      const newGitResults = { ...state.gitResults };
      delete newGitResults[id];
      return {
        sessions: newSessions,
        activeSessionId: newActiveId,
        closedSessionIds: [...state.closedSessionIds, id],
        folderResults: newFolderResults,
        gitResults: newGitResults,
      };
    });
  },

  reopenLastClosed: () => {
    // Not persisting closed sessions content, so this is a no-op for now
  },

  setActiveSession: (id) => {
    set((state) => ({
      activeSessionId: id,
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, lastAccessedAt: Date.now() } : s)),
    }));
  },

  updateSession: (id, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  },

  setFilterMode: (id, mode) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, filterMode: mode } : s)),
    }));
  },

  setExcludePatterns: (id, patterns) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id && (s.type === "folder" || s.type === "git") ? { ...s, excludePatterns: patterns } : s,
      ),
    }));
  },

  setFolderResult: (sessionId, result) => {
    set((state) => ({
      folderResults: { ...state.folderResults, [sessionId]: result },
    }));
  },

  setGitResult: (sessionId, result) => {
    set((state) => ({
      gitResults: { ...state.gitResults, [sessionId]: result },
    }));
  },

  persist: async () => {
    const { sessions, activeSessionId } = get();
    const state: PersistedState = {
      version: 1,
      sessions,
      activeSessionId,
    };
    try {
      await window.electronAPI.sessionSaveAll(state);
    } catch (err) {
      console.error("Failed to persist sessions:", err);
    }
  },

  restore: async () => {
    try {
      const state = await window.electronAPI.sessionLoadAll();
      if (state && state.version === 1) {
        set({
          sessions: state.sessions || [],
          activeSessionId: state.activeSessionId || null,
        });
      }
    } catch (err) {
      console.error("Failed to restore sessions:", err);
    }
  },
}));
