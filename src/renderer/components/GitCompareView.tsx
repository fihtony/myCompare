import React, { useState, useCallback, useEffect, useRef } from "react";
import type { GitSession, GitRef, GitCompareResult, GitDiffItem } from "@shared/types";
import { CompareState } from "@shared/types";
import { useSessionStore } from "../store/session-store";
import { log, error as logError } from "../../shared/logger";
import "./GitCompareView.css";

const stateIcons: Record<string, string> = {
  equal: "=",
  modified: "≠",
  "only-left": "←",
  "only-right": "→",
  "binary-diff": "⊕",
  whitespace: "~",
  error: "!",
};
const stateColors: Record<string, string> = {
  equal: "var(--state-equal)",
  modified: "var(--state-modified)",
  "only-left": "var(--state-only-left)",
  "only-right": "var(--state-only-right)",
  "binary-diff": "var(--state-binary)",
  whitespace: "var(--state-whitespace)",
  error: "var(--state-error)",
};

function mergeState(a: string, b: string): CompareState {
  const priority: Record<string, number> = {
    [CompareState.ERROR]: 5,
    [CompareState.MODIFIED]: 4,
    [CompareState.BINARY_DIFFER]: 4,
    [CompareState.WHITESPACE]: 4,
    [CompareState.ONLY_LEFT]: 3,
    [CompareState.ONLY_RIGHT]: 3,
    [CompareState.EQUAL]: 0,
  };
  return ((priority[b] ?? 0) > (priority[a] ?? 0) ? b : a) as CompareState;
}

function buildTreeItems(items: GitDiffItem[]): GitDiffItem[] {
  const existingPaths = new Set(items.map((it) => it.relativePath));
  const dirStateMap = new Map<string, CompareState>();
  for (const item of items) {
    if (item.type === "directory") continue;
    const parts = item.relativePath.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const dirPath = parts.slice(0, depth).join("/");
      dirStateMap.set(dirPath, mergeState(dirStateMap.get(dirPath) ?? CompareState.EQUAL, item.state));
    }
  }
  const synthDirs: GitDiffItem[] = [];
  for (const [dirPath, state] of dirStateMap) {
    if (!existingPaths.has(dirPath)) {
      synthDirs.push({
        relativePath: dirPath,
        name: dirPath.split("/").pop() || dirPath,
        state,
        type: "directory",
      } as GitDiffItem);
    }
  }
  return [...synthDirs, ...items].sort((a, b) => {
    const ap = a.relativePath.split("/");
    const bp = b.relativePath.split("/");
    const minLen = Math.min(ap.length, bp.length);
    for (let i = 0; i < minLen; i++) {
      if (ap[i] !== bp[i]) return ap[i].localeCompare(bp[i]);
      // Segments match up to here; if one path is shorter it is an ancestor — sort it first
      if (i === minLen - 1 && ap.length !== bp.length) {
        return ap.length < bp.length ? -1 : 1;
      }
    }
    // Same path at same depth: dirs before files, then by name
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function isAncestorCollapsed(relativePath: string, collapsed: Set<string>): boolean {
  const parts = relativePath.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (collapsed.has(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

const _gcCollapsedCache = new Map<string, Set<string>>();
const _gcScrollCache = new Map<string, number>();
const _gcAutoCollapsed = new Set<string>();

interface Props {
  session: GitSession;
}

export default function GitCompareView({ session }: Props) {
  const { gitResults, setGitResult, updateSession, createFileSession, setFilterMode } = useSessionStore();
  const result = gitResults[session.id] as GitCompareResult | undefined;

  const [repoPath, setRepoPath] = useState(session.repoPath);
  const [refs, setRefs] = useState<GitRef[]>([]);
  const [leftRef, setLeftRef] = useState(session.leftRef);
  const [rightRef, setRightRef] = useState(session.rightRef);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);
  const [refFilter, setRefFilter] = useState("");
  const [openingFile, setOpeningFile] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [collapsedDirs, _setCollapsedRaw] = useState<Set<string>>(() => _gcCollapsedCache.get(session.id) ?? new Set());
  const setCollapsedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      _setCollapsedRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        _gcCollapsedCache.set(session.id, next);
        return next;
      });
    },
    [session.id],
  );
  const toggleCollapse = useCallback(
    (relPath: string) => {
      setCollapsedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(relPath)) next.delete(relPath);
        else next.add(relPath);
        return next;
      });
    },
    [setCollapsedDirs],
  );

  const collapseAll = useCallback(() => {
    if (!result) return;
    const dirs = new Set<string>();
    for (const item of result.items) {
      const gi = item as unknown as GitDiffItem;
      const parts = gi.relativePath.split("/");
      for (let d = 1; d < parts.length; d++) dirs.add(parts.slice(0, d).join("/"));
      if (gi.type === "directory") dirs.add(gi.relativePath);
    }
    setCollapsedDirs(dirs);
  }, [result, setCollapsedDirs]);

  const expandAll = useCallback(() => setCollapsedDirs(new Set()), [setCollapsedDirs]);

  useEffect(() => {
    if (!result || _gcAutoCollapsed.has(session.id)) return;
    _gcAutoCollapsed.add(session.id);
    collapseAll();
  }, [result, session.id, collapseAll]);

  // Auto-compare when both refs are selected
  useEffect(() => {
    if (repoPath && leftRef && rightRef) {
      doCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftRef, rightRef]);

  const loadRefs = useCallback(async (rp: string) => {
    if (!rp) return;
    setRefsLoading(true);
    try {
      const isRepo = await window.electronAPI.gitIsRepo(rp);
      if (!isRepo) {
        setErrorMsg("Not a Git repository");
        setRefs([]);
        return;
      }
      setRefs(await window.electronAPI.gitListRefs(rp));
      setErrorMsg(null);
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
      setRefs([]);
    } finally {
      setRefsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session.repoPath) loadRefs(session.repoPath);
    const saved = _gcScrollCache.get(session.id);
    if (saved !== undefined && scrollRef.current) scrollRef.current.scrollTop = saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const handleSelectRepo = async () => {
    const p = await window.electronAPI.dialogSelectFolder();
    if (p) {
      setRepoPath(p);
      loadRefs(p);
    }
  };

  const doCompare = useCallback(async () => {
    if (!repoPath || !leftRef || !rightRef) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      updateSession(session.id, { repoPath, leftRef, rightRef } as Partial<GitSession>);
      const res = await window.electronAPI.compareGit(repoPath, leftRef, rightRef);
      setGitResult(session.id, res);
      const repoName = repoPath.split("/").pop() || repoPath;
      updateSession(session.id, { name: `${repoName} (${leftRef} ↔ ${rightRef})` } as Partial<GitSession>);
      log("GitCompare", `Compare done: ${res.stats.total} items`);
    } catch (err: unknown) {
      logError("GitCompare", (err as Error).message || "Git compare failed", err as Error);
      setErrorMsg((err as Error).message || "Git compare failed");
    } finally {
      setLoading(false);
    }
  }, [repoPath, leftRef, rightRef, session.id, updateSession, setGitResult]);

  const handleSwap = () => {
    setLeftRef(rightRef);
    setRightRef(leftRef);
  };

  const handleDoubleClick = async (item: GitDiffItem) => {
    if (item.type === "directory") {
      toggleCollapse(item.relativePath);
      return;
    }
    if (!repoPath || !leftRef || !rightRef) return;
    if (openingFile === item.relativePath) return;
    setOpeningFile(item.relativePath);
    try {
      const leftTmp =
        item.state !== CompareState.ONLY_RIGHT ? await window.electronAPI.gitExtractFile(repoPath, leftRef, item.relativePath) : "";
      const rightTmp =
        item.state !== CompareState.ONLY_LEFT ? await window.electronAPI.gitExtractFile(repoPath, rightRef, item.relativePath) : "";
      createFileSession(leftTmp, rightTmp, session.id);
    } catch (err: unknown) {
      setErrorMsg(`Failed to extract file: ${(err as Error).message}`);
    } finally {
      setOpeningFile(null);
    }
  };

  const toggleFilter = () => {
    setFilterMode(session.id, session.filterMode === "all" ? "diff-only" : "all");
  };

  const branches = refs.filter((r) => r.type === "branch");
  const tags = refs.filter((r) => r.type === "tag");
  const commits = refs.filter((r) => r.type === "commit");
  const _filteredRefs = refs.filter((r) => (refFilter ? r.name.toLowerCase().includes(refFilter.toLowerCase()) : true));
  void _filteredRefs;

  const treeItems = result ? buildTreeItems(result.items as unknown as GitDiffItem[]) : [];
  const filteredItems = treeItems.filter((item) => !(session.filterMode === "diff-only" && item.state === CompareState.EQUAL));
  const visibleItems = filteredItems.filter((item) => !isAncestorCollapsed(item.relativePath, collapsedDirs));

  const RefSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="gc-ref-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">-- Select Ref --</option>
      {branches.length > 0 && (
        <optgroup label="Branches">
          {branches.map((r) => (
            <option key={r.name} value={r.name}>
              {r.current ? "* " : ""}
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
      {tags.length > 0 && (
        <optgroup label="Tags">
          {tags.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
      {commits.length > 0 && (
        <optgroup label="Recent Commits">
          {commits.map((r) => (
            <option key={r.hash} value={r.hash}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );

  return (
    <div className="git-compare">
      {/* Toolbar */}
      <div className="gc-toolbar">
        <button className="icon-btn" onClick={handleSwap} data-tooltip="Swap Refs">
          ⇄
        </button>
        <button className="icon-btn" onClick={doCompare} data-tooltip="Compare">
          ▶
        </button>
        <button className="icon-btn" onClick={() => loadRefs(repoPath)} data-tooltip="Refresh Refs">
          ↻
        </button>
        <div className="toolbar-sep" />
        <button
          className="icon-btn"
          onClick={toggleFilter}
          data-tooltip={session.filterMode === "all" ? "Show Differences Only" : "Show All Files"}
          style={{
            color: session.filterMode === "diff-only" ? "var(--state-modified, #e06c00)" : undefined,
            fontWeight: session.filterMode === "diff-only" ? 700 : undefined,
          }}
        >
          {session.filterMode === "diff-only" ? "≠" : "="}
        </button>
        <button className="icon-btn" onClick={collapseAll} data-tooltip="Collapse All">
          ⊖
        </button>
        <button className="icon-btn" onClick={expandAll} data-tooltip="Expand All">
          ⊕
        </button>
        {result && (
          <span className="gc-stats">
            {result.stats.modified} diff · {result.stats.onlyLeft + result.stats.onlyRight} added/removed · {result.stats.equal} equal
          </span>
        )}
      </div>

      {/* Repo + Ref bar */}
      <div className="gc-path-bar">
        <div className="gc-repo-group">
          <span className="gc-label">Repo:</span>
          <input
            type="text"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            onBlur={() => loadRefs(repoPath)}
            placeholder="Git repository path…"
            className="gc-repo-input"
          />
          <button className="icon-btn" onClick={handleSelectRepo} data-tooltip="Browse">
            📂
          </button>
          <input
            type="text"
            className="gc-ref-filter"
            placeholder="Filter refs…"
            value={refFilter}
            onChange={(e) => setRefFilter(e.target.value)}
            style={{ marginLeft: "auto" }}
          />
        </div>
        <div className="gc-ref-selectors">
          <div className="gc-ref-group">
            <span className="gc-label">Left:</span>
            <RefSelect value={leftRef} onChange={setLeftRef} />
          </div>
          <div className="gc-ref-group">
            <span className="gc-label">Right:</span>
            <RefSelect value={rightRef} onChange={setRightRef} />
          </div>
        </div>
      </div>

      {/* Tree Content */}
      <div
        className="gc-content"
        ref={scrollRef}
        onScroll={() => {
          if (scrollRef.current) _gcScrollCache.set(session.id, scrollRef.current.scrollTop);
        }}
      >
        {(loading || refsLoading) && <div className="gc-loading">Comparing…</div>}
        {errorMsg && <div className="gc-error">{errorMsg}</div>}
        {!loading && !errorMsg && !result && <div className="gc-placeholder">Select a repository and two refs, then click Compare ▶</div>}
        {!loading && result && (
          <div className="gc-result-table">
            <div className="gc-items">
              {visibleItems.map((item, idx) => {
                const depth = item.relativePath.split("/").length - 1;
                const isDir = item.type === "directory";
                const isCollapsed = isDir && collapsedDirs.has(item.relativePath);
                const onlyLeft = item.state === CompareState.ONLY_LEFT;
                const onlyRight = item.state === CompareState.ONLY_RIGHT;
                const isOrphan = onlyLeft || onlyRight;
                const indentStyle = { paddingLeft: `${depth * 16}px` };
                const isOpening = !isDir && openingFile === item.relativePath;
                const colorStyle = { color: stateColors[item.state] };

                return (
                  <div
                    key={idx}
                    className={"gc-tree-row" + (isDir ? " gc-row-dir" : "") + (isOpening ? " gc-row-opening" : "")}
                    onClick={isDir ? () => toggleCollapse(item.relativePath) : undefined}
                    onDoubleClick={() => handleDoubleClick(item)}
                    title={isDir ? "Click to toggle" : "Double-click to open diff"}
                  >
                    {/* Left name */}
                    <div className="gc-name-cell" style={indentStyle}>
                      <span
                        className="gc-col-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isDir) toggleCollapse(item.relativePath);
                        }}
                      >
                        {isDir && !onlyRight ? (isCollapsed ? "▶" : "▼") : ""}
                      </span>
                      {onlyRight ? (
                        <span className="gc-orphan-blank" />
                      ) : (
                        <span className={"gc-col-name" + (onlyLeft ? " gc-name-orphan" : "")} style={colorStyle}>
                          {isDir ? "📁 " : ""}
                          {item.name}
                        </span>
                      )}
                    </div>

                    {/* Center icon — blank for orphan */}
                    <span className="gc-col-cmp" style={colorStyle}>
                      {isOrphan ? "" : stateIcons[item.state] || "?"}
                    </span>

                    {/* Right name */}
                    <div className="gc-name-cell" style={indentStyle}>
                      <span
                        className="gc-col-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isDir) toggleCollapse(item.relativePath);
                        }}
                      >
                        {isDir && !onlyLeft ? (isCollapsed ? "▶" : "▼") : ""}
                      </span>
                      {onlyLeft ? (
                        <span className="gc-orphan-blank" />
                      ) : (
                        <span className={"gc-col-name" + (onlyRight ? " gc-name-orphan" : "")} style={colorStyle}>
                          {isDir ? "📁 " : ""}
                          {item.name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
