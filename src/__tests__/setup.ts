import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock CSS imports
vi.mock("highlight.js/styles/atom-one-dark.css", () => ({}));

// Mock window.electronAPI globally
const mockElectronAPI = {
  compareFolders: vi.fn(),
  compareFiles: vi.fn(),
  compareGit: vi.fn(),
  sessionSaveAll: vi.fn(),
  sessionLoadAll: vi.fn(),
  fileRead: vi.fn(),
  fileWrite: vi.fn(),
  fileDetectBinary: vi.fn().mockResolvedValue(false),
  fileReadHex: vi.fn(),
  pathStat: vi.fn(),
  fileStat: vi.fn().mockResolvedValue({ size: 0, birthtime: 0, mtime: 0, readonly: false, hidden: false }),
  fileCopy: vi.fn(),
  dialogSelectFolder: vi.fn(),
  dialogSelectFile: vi.fn(),
  gitListRefs: vi.fn(),
  gitExtractFile: vi.fn(),
  gitMergeBase: vi.fn(),
  gitIsRepo: vi.fn(),
  onDropFiles: vi.fn(),
  getPathForFile: vi.fn().mockReturnValue(""),
};

export { mockElectronAPI };

// Only set up window.electronAPI in jsdom environments (not in node environment)
if (typeof window !== "undefined") {
  Object.defineProperty(window, "electronAPI", {
    value: mockElectronAPI,
    writable: true,
  });
}
