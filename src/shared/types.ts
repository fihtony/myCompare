// Session types
export type SessionType = "folder" | "file" | "git";
export type FilterMode = "all" | "diff-only";
export type FileViewMode = "text" | "hex";

export interface BaseSession {
  id: string;
  name: string;
  type: SessionType;
  filterMode: FilterMode;
  createdAt: number;
  lastAccessedAt: number;
}

export interface FolderSession extends BaseSession {
  type: "folder";
  leftPath: string;
  rightPath: string;
  excludePatterns: string[];
}

export interface FileSession extends BaseSession {
  type: "file";
  leftPath: string;
  rightPath: string;
  basePath?: string;
  parentSessionId?: string;
  viewMode: FileViewMode;
}

export interface GitSession extends BaseSession {
  type: "git";
  repoPath: string;
  leftRef: string;
  rightRef: string;
  mergeBase?: string;
  excludePatterns: string[];
}

export type Session = FolderSession | FileSession | GitSession;

// Compare state
export enum CompareState {
  ONLY_LEFT = "only-left",
  ONLY_RIGHT = "only-right",
  EQUAL = "equal",
  MODIFIED = "modified",
  WHITESPACE = "whitespace",
  BINARY_DIFFER = "binary-diff",
  ERROR = "error",
}

export interface CompareItem {
  relativePath: string;
  name: string;
  type: "file" | "directory";
  state: CompareState;
  leftSize?: number;
  rightSize?: number;
  leftDate?: number;
  rightDate?: number;
  isHidden: boolean;
  children?: CompareItem[];
}

export interface FolderCompareResult {
  leftPath: string;
  rightPath: string;
  items: CompareItem[];
  stats: CompareStats;
}

export interface CompareStats {
  equal: number;
  modified: number;
  onlyLeft: number;
  onlyRight: number;
  errors: number;
  total: number;
}

// Git types
export interface GitRef {
  name: string;
  type: "branch" | "tag" | "commit";
  hash: string;
  current?: boolean;
}

export interface GitDiffItem {
  relativePath: string;
  name: string;
  state: CompareState;
  type: "file" | "directory";
  /**
   * For a rename pair: the path of the counterpart in the OTHER ref.
   * - On the ONLY_LEFT half:  this is the new path (exists in rightRef)
   * - On the ONLY_RIGHT half: this is the old path (exists in leftRef)
   * Used when double-clicking to open the before/after diff.
   */
  renamedCounterpart?: string;
}

export interface GitCompareResult {
  repoPath: string;
  leftRef: string;
  rightRef: string;
  items: GitDiffItem[];
  stats: CompareStats;
}

// Persistence
export interface PersistedState {
  version: number;
  sessions: Session[];
  activeSessionId: string | null;
}

// Detailed file stat for footbar display
export interface FileStatInfo {
  size: number;
  birthtime: number; // ms since epoch (ctime on some systems)
  mtime: number; // ms since epoch
  readonly: boolean;
  hidden: boolean; // name starts with '.'
}

// Path stat result
export interface PathStat {
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
}

// Hex view chunk
export interface HexChunk {
  offset: number;
  totalSize: number;
  rows: HexRow[];
}

export interface HexRow {
  offset: number;
  bytes: number[]; // up to 16 bytes
  ascii: string;
}

// IPC API shape exposed to renderer
export interface ElectronAPI {
  compareFolder: (leftPath: string, rightPath: string, excludePatterns: string[]) => Promise<FolderCompareResult>;
  compareFile: (leftPath: string, rightPath: string) => Promise<string[]>;
  compareGit: (repoPath: string, leftRef: string, rightRef: string) => Promise<GitCompareResult>;
  sessionSaveAll: (state: PersistedState) => Promise<void>;
  sessionLoadAll: () => Promise<PersistedState | null>;
  fileRead: (filePath: string) => Promise<string>;
  fileReadLines: (filePath: string, maxLines: number) => Promise<{ content: string; truncated: boolean; lineCount: number }>;
  fileWrite: (filePath: string, content: string) => Promise<void>;
  fileCopy: (src: string, dst: string) => Promise<void>;
  fileDetectBinary: (filePath: string) => Promise<boolean>;
  fileReadHex: (filePath: string, offset: number, length: number) => Promise<HexChunk>;
  pathStat: (p: string) => Promise<PathStat>;
  fileStat: (filePath: string) => Promise<FileStatInfo>;
  dialogSelectFolder: () => Promise<string | null>;
  dialogSelectFile: () => Promise<string | null>;
  dialogSaveFile: (defaultPath: string) => Promise<string | null>;
  gitListRefs: (repoPath: string) => Promise<GitRef[]>;
  gitExtractFile: (repoPath: string, ref: string, filePath: string) => Promise<string>;
  gitMergeBase: (repoPath: string, ref1: string, ref2: string) => Promise<string>;
  gitIsRepo: (dirPath: string) => Promise<boolean>;
  onDropFiles: (callback: (paths: string[]) => void) => void;
  closeAboutDialog: () => void;
  notifyThemeChanged: (theme: "dark" | "light") => void;
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
