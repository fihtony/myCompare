import React, { useState, useCallback, useEffect, useRef } from "react";
import type { FolderSession, FolderCompareResult, CompareItem } from "@shared/types";
import { CompareState } from "@shared/types";
import { useSessionStore } from "../store/session-store";
import { log, error as logError } from "../../shared/logger";
import "./FolderCompareView.css";

// Module-level caches — survive component unmount (tab switches)
const _collapsedCache = new Map<string, Set<string>>();
const _showHiddenCache = new Map<string, boolean>();
const _scrollCache = new Map<string, number>();
const _excludeInputCache = new Map<string, string>();

interface Props {
  session: FolderSession;
}

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}/${mm}/${dd} ${hh}:${min}`;
}

/** Sum the size of all file-type descendants for a directory.
 * Skips files where size is unknown (null) rather than bailing on the first null.
 * Returns undefined only when there are no files at all under this directory.
 */
function computeDirSize(dirRelPath: string, allItems: CompareItem[], side: "left" | "right"): number | undefined {
  const prefix = dirRelPath + "/";
  const files = allItems.filter((it) => it.type === "file" && it.relativePath.startsWith(prefix));
  if (files.length === 0) return undefined;
  const key = side === "left" ? "leftSize" : "rightSize";
  let total = 0;
  let hasAny = false;
  for (const f of files) {
    const v = f[key];
    if (v != null) {
      total += v;
      hasAny = true;
    }
  }
  return hasAny ? total : undefined;
}

/** Check whether any ancestor directory of the given relativePath is in the collapsed set. */
function isAncestorCollapsed(relativePath: string, collapsed: Set<string>): boolean {
  const parts = relativePath.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (collapsed.has(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

/** Simple glob-style matcher: supports * (any chars) and ? (one char). Case-insensitive. */
function matchesGlob(name: string, pattern: string): boolean {
  if (!pattern) return false;
  // Escape all regex meta chars except * and ?
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i").test(name);
}

/** Return true if the item's relative path contains a segment matching any of the given patterns. */
function isExcludedByPatterns(relativePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const segments = relativePath.replace(/\\/g, "/").split("/");
  return patterns.some((pat) => segments.some((seg) => matchesGlob(seg, pat)));
}

/** Check whether any ancestor directory of the given relativePath is hidden (starts with dot). */
function isAncestorHidden(relativePath: string): boolean {
  const parts = relativePath.split("/");
  // Check each ancestor component (not the item itself, which is already filtered separately)
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].startsWith(".")) return true;
  }
  return false;
}

/**
 * Derive the aggregate display state for a directory row by examining all
 * file-type descendants in the flat items list.
 * - All equal → "equal"
 * - Any only-left present (and no only-right / modified) → "only-left"
 * - Any only-right present (and no only-left / modified) → "only-right"
 * - Mixed / any modified → "modified"
 */
function computeDirState(dirRelPath: string, allItems: CompareItem[]): CompareState {
  const prefix = dirRelPath + "/";
  const descendants = allItems.filter((it) => it.type === "file" && (it.relativePath === dirRelPath || it.relativePath.startsWith(prefix)));
  if (descendants.length === 0) return CompareState.EQUAL;
  const states = new Set(descendants.map((d) => d.state));
  if (states.size === 1 && states.has(CompareState.EQUAL)) return CompareState.EQUAL;
  const hasLeft = states.has(CompareState.ONLY_LEFT);
  const hasRight = states.has(CompareState.ONLY_RIGHT);
  const hasMod = states.has(CompareState.MODIFIED) || states.has(CompareState.BINARY_DIFFER) || states.has(CompareState.WHITESPACE);
  if (!hasMod && hasLeft && !hasRight) return CompareState.ONLY_LEFT;
  if (!hasMod && !hasLeft && hasRight) return CompareState.ONLY_RIGHT;
  return CompareState.MODIFIED;
}

export default function FolderCompareView({ session }: Props) {
  const { folderResults, setFolderResult, updateSession, createFileSession } = useSessionStore();
  const result = folderResults[session.id];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [leftPath, setLeftPath] = useState(session.leftPath);
  const [rightPath, setRightPath] = useState(session.rightPath);
  const [excludeInput, setExcludeInput] = useState(() => _excludeInputCache.get(session.id) ?? session.excludePatterns.join(", "));
  const scrollRef = useRef<HTMLDivElement>(null);

  const [collapsedDirs, _setCollapsedDirsRaw] = useState<Set<string>>(() => _collapsedCache.get(session.id) ?? new Set());
  const [showHidden, _setShowHiddenRaw] = useState<boolean>(() => _showHiddenCache.get(session.id) ?? true);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  /** Async-computed directory sizes — Map<relativePath, {left?, right?}> */
  const [dirSizeMap, setDirSizeMap] = useState<Map<string, { left?: number; right?: number }>>(new Map());

  const setCollapsedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      _setCollapsedDirsRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        _collapsedCache.set(session.id, next);
        return next;
      });
    },
    [session.id],
  );

  const setShowHidden = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      _setShowHiddenRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        _showHiddenCache.set(session.id, next);
        return next;
      });
    },
    [session.id],
  );

  /** Compute directory sizes asynchronously in background chunks. */
  useEffect(() => {
    if (!result) {
      setDirSizeMap(new Map());
      return;
    }
    const dirs = result.items.filter((it) => it.type === "directory");
    if (dirs.length === 0) return;
    let cancelled = false;
    const newMap = new Map<string, { left?: number; right?: number }>();
    const CHUNK = 30;
    let idx = 0;
    const items = result.items;
    function processChunk() {
      if (cancelled) return;
      const end = Math.min(idx + CHUNK, dirs.length);
      for (let j = idx; j < end; j++) {
        const dir = dirs[j];
        newMap.set(dir.relativePath, {
          left: computeDirSize(dir.relativePath, items, "left"),
          right: computeDirSize(dir.relativePath, items, "right"),
        });
      }
      idx = end;
      if (idx < dirs.length) setTimeout(processChunk, 0);
      else if (!cancelled) setDirSizeMap(new Map(newMap));
    }
    setTimeout(processChunk, 0);
    return () => {
      cancelled = true;
    };
  }, [result]);

  /** Collapse all directories whenever a new comparison result arrives. */
  useEffect(() => {
    if (!result) return;
    const dirPaths = new Set(result.items.filter((it) => it.type === "directory").map((it) => it.relativePath));
    setCollapsedDirs(dirPaths);
  }, [result, setCollapsedDirs]);

  const doCompare = useCallback(
    async (overrideLeft?: string, overrideRight?: string) => {
      const lp = overrideLeft ?? leftPath;
      const rp = overrideRight ?? rightPath;
      if (!lp || !rp) return;
      setLoading(true);
      setError(null);
      log("FolderCompare", `Starting comparison: ${lp} vs ${rp}`);
      try {
        const patterns = excludeInput
          .split(/[,;]/)
          .map((p) => p.trim())
          .filter(Boolean);
        log("FolderCompare", `Exclude patterns (client-side only): [${patterns.join(", ")}]`);
        updateSession(session.id, { leftPath: lp, rightPath: rp, excludePatterns: patterns } as any);
        // Always scan everything; exclude patterns are applied client-side so they can be
        // toggled instantly without re-running a full backend compare.
        const res = await window.electronAPI.compareFolder(lp, rp, []);
        log(
          "FolderCompare",
          `Compare complete: ${res.stats.total} items (${res.stats.equal} equal, ${res.stats.modified} modified, ${res.stats.onlyLeft} left-only, ${res.stats.onlyRight} right-only)`,
        );
        setFolderResult(session.id, res);
        const ln = lp.split("/").pop() || lp;
        const rn = rp.split("/").pop() || rp;
        updateSession(session.id, { name: `${ln} ↔ ${rn}` });
      } catch (err: any) {
        const msg = err.message || "Compare failed";
        logError("FolderCompare", msg, err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [leftPath, rightPath, excludeInput, session.id],
  );

  useEffect(() => {
    if (session.leftPath && session.rightPath) {
      log("FolderCompare", `Auto-compare on mount: ${session.leftPath} vs ${session.rightPath}`);
      doCompare();
    }
    // Restore scroll position
    const saved = _scrollCache.get(session.id);
    if (saved !== undefined && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // When a pending session gets its right path filled (via drag-and-drop),
  // sync local state and trigger compare.
  useEffect(() => {
    if (session.rightPath && session.rightPath !== rightPath) {
      setRightPath(session.rightPath);
      const lp = leftPath || session.leftPath;
      if (lp) {
        doCompare(lp, session.rightPath);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.rightPath]);

  const handleSelectLeft = async () => {
    const p = await window.electronAPI.dialogSelectFolder();
    if (p) {
      setLeftPath(p);
      if (rightPath) doCompare(p, rightPath);
    }
  };

  const handleSelectRight = async () => {
    const p = await window.electronAPI.dialogSelectFolder();
    if (p) {
      setRightPath(p);
      if (leftPath) doCompare(leftPath, p);
    }
  };

  const handleSwap = () => {
    const newLeft = rightPath;
    const newRight = leftPath;
    setLeftPath(newLeft);
    setRightPath(newRight);
    doCompare(newLeft, newRight);
  };

  const handleRowClick = (item: CompareItem, e: React.MouseEvent) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        // Toggle this item in multi-selection
        if (next.has(item.relativePath)) next.delete(item.relativePath);
        else next.add(item.relativePath);
      } else {
        // Single-select; click again to deselect
        if (next.size === 1 && next.has(item.relativePath)) next.clear();
        else {
          next.clear();
          next.add(item.relativePath);
        }
      }
      return next;
    });
  };

  const handleDoubleClick = (item: CompareItem) => {
    if (item.type === "directory") {
      toggleCollapse(item.relativePath);
    } else {
      // Pass empty string for the side that doesn't exist — FileDiffView handles one-sided display
      const lp = item.state !== "only-right" ? `${leftPath}/${item.relativePath}` : "";
      const rp = item.state !== "only-left" ? `${rightPath}/${item.relativePath}` : "";
      createFileSession(lp, rp, session.id);
    }
  };

  const toggleCollapse = (relativePath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  };

  const collapseAll = useCallback(() => {
    if (!result) return;
    const dirPaths = new Set(result.items.filter((i) => i.type === "directory").map((i) => i.relativePath));
    setCollapsedDirs(dirPaths);
  }, [result, setCollapsedDirs]);

  const expandAll = useCallback(() => {
    setCollapsedDirs(new Set());
  }, [setCollapsedDirs]);

  /**
   * Collect copy-eligible files based on current selection.
   * - If items are selected: files in selection + file descendants of selected dirs.
   * - Otherwise: all diff files.
   */
  function collectCopyFiles(direction: "toRight" | "toLeft"): CompareItem[] {
    if (!result) return [];
    const validStates = direction === "toRight" ? ["modified", "only-left"] : ["modified", "only-right"];

    if (selectedPaths.size > 0) {
      const collected: CompareItem[] = [];
      for (const relPath of selectedPaths) {
        const sel = result.items.find((i) => i.relativePath === relPath);
        if (!sel) continue;
        if (sel.type === "file") {
          if (validStates.includes(sel.state)) collected.push(sel);
        } else {
          // directory: collect all file descendants
          const prefix = relPath + "/";
          result.items.forEach((i) => {
            if (i.type === "file" && i.relativePath.startsWith(prefix) && validStates.includes(i.state)) {
              collected.push(i);
            }
          });
        }
      }
      // Deduplicate
      const seen = new Set<string>();
      return collected.filter((i) => (seen.has(i.relativePath) ? false : seen.add(i.relativePath) && true));
    }
    // No selection: copy all diff files
    return result.items.filter((i) => i.type === "file" && validStates.includes(i.state));
  }

  /**
   * Copy changed files from left → right.
   * - modified: overwrite right with left
   * - only-left: create file on right
   * - only-right: leave alone (no deletion)
   * - equal: skip
   */
  const handleCopyToRight = async () => {
    if (!result || !leftPath || !rightPath) return;
    const candidates = collectCopyFiles("toRight");
    if (!candidates.length) {
      setCopyStatus("Nothing to copy.");
      return;
    }
    setCopyStatus(`Copying ${candidates.length} file(s)…`);
    let done = 0;
    for (const item of candidates) {
      try {
        await window.electronAPI.fileCopy(`${leftPath}/${item.relativePath}`, `${rightPath}/${item.relativePath}`);
        done++;
      } catch (err: any) {
        logError("FolderCompare", `Copy failed: ${item.relativePath}`, err);
      }
    }
    setCopyStatus(`Done: ${done}/${candidates.length} file(s) copied.`);
    await doCompare();
    setTimeout(() => setCopyStatus(null), 3000);
  };

  /**
   * Copy changed files from right → left.
   * - modified: overwrite left with right
   * - only-right: create file on left
   * - only-left: leave alone (no deletion)
   * - equal: skip
   */
  const handleCopyToLeft = async () => {
    if (!result || !leftPath || !rightPath) return;
    const candidates = collectCopyFiles("toLeft");
    if (!candidates.length) {
      setCopyStatus("Nothing to copy.");
      return;
    }
    setCopyStatus(`Copying ${candidates.length} file(s)…`);
    let done = 0;
    for (const item of candidates) {
      try {
        await window.electronAPI.fileCopy(`${rightPath}/${item.relativePath}`, `${leftPath}/${item.relativePath}`);
        done++;
      } catch (err: any) {
        logError("FolderCompare", `Copy failed: ${item.relativePath}`, err);
      }
    }
    setCopyStatus(`Done: ${done}/${candidates.length} file(s) copied.`);
    await doCompare();
    setTimeout(() => setCopyStatus(null), 3000);
  };

  const excludePatterns = excludeInput
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);

  const filteredItems = result?.items.filter((item) => {
    if (!showHidden) {
      // Hide hidden items themselves
      if (item.isHidden) return false;
      // Hide items inside hidden ancestor directories
      if (isAncestorHidden(item.relativePath)) return false;
    }
    if (session.filterMode === "diff-only") {
      // For directories: use the aggregated state derived from file descendants,
      // because dir-compare may mark a directory as "equal" even when children differ.
      if (item.type === "directory") {
        if (computeDirState(item.relativePath, result.items) === CompareState.EQUAL) return false;
      } else {
        if (item.state === "equal") return false;
      }
    }
    // Client-side exclude pattern filtering (instant feedback while backend re-compare is pending)
    if (isExcludedByPatterns(item.relativePath, excludePatterns)) return false;
    return true;
  });

  const visibleItems = filteredItems?.filter((item) => !isAncestorCollapsed(item.relativePath, collapsedDirs));

  // Compute stats from the client-filtered file list so exclude patterns and diff-only
  // mode are reflected in the summary bar.
  const filteredFileItems = filteredItems?.filter((i) => i.type === "file");
  const filteredStats = filteredFileItems
    ? {
        modified: filteredFileItems.filter((i) => i.state === "modified").length,
        onlyLeft: filteredFileItems.filter((i) => i.state === "only-left").length,
        onlyRight: filteredFileItems.filter((i) => i.state === "only-right").length,
        equal: filteredFileItems.filter((i) => i.state === "equal").length,
      }
    : null;

  const toggleFilter = () => {
    const store = useSessionStore.getState();
    store.setFilterMode(session.id, session.filterMode === "all" ? "diff-only" : "all");
  };

  return (
    <div className="folder-compare">
      {/* Toolbar */}
      <div className="fc-toolbar">
        <button className="icon-btn" onClick={handleSwap} data-tooltip="Swap Sides">
          ⇄
        </button>
        <button className="icon-btn" onClick={() => doCompare()} data-tooltip="Compare (⌘R)">
          ▶
        </button>
        <button className="icon-btn" onClick={() => doCompare()} data-tooltip="Refresh">
          ↻
        </button>
        <div className="toolbar-sep" />
        {(() => {
          const toRight = result ? collectCopyFiles("toRight") : [];
          const toLeft = result ? collectCopyFiles("toLeft") : [];
          const selCount = selectedPaths.size;
          const rightTip =
            selCount > 0
              ? toRight.length > 0
                ? `Copy ${toRight.length} selected file(s) → Right`
                : "No copyable files in selection"
              : `Copy all ${toRight.length} changed file(s) → Right`;
          const leftTip =
            selCount > 0
              ? toLeft.length > 0
                ? `Copy ${toLeft.length} selected file(s) ← Left`
                : "No copyable files in selection"
              : `Copy all ${toLeft.length} changed file(s) ← Left`;
          return (
            <>
              <button
                className="icon-btn"
                onClick={handleCopyToRight}
                data-tooltip={rightTip}
                disabled={toRight.length === 0}
                style={{ opacity: toRight.length === 0 ? 0.35 : undefined }}
              >
                →
              </button>
              <button
                className="icon-btn"
                onClick={handleCopyToLeft}
                data-tooltip={leftTip}
                disabled={toLeft.length === 0}
                style={{ opacity: toLeft.length === 0 ? 0.35 : undefined }}
              >
                ←
              </button>
            </>
          );
        })()}
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
        <button className="icon-btn" onClick={collapseAll} data-tooltip="Collapse All Folders" title="Collapse all folders">
          ⊖
        </button>
        <button className="icon-btn" onClick={expandAll} data-tooltip="Expand All Folders" title="Expand all folders">
          ⊕
        </button>
        <button
          className={`icon-btn${showHidden ? " icon-btn--active" : ""}`}
          onClick={() => setShowHidden((v: boolean) => !v)}
          data-tooltip={showHidden ? "Hide Dotfiles" : "Show Dotfiles"}
          title={showHidden ? "Dotfiles visible — click to hide" : "Dotfiles hidden — click to show"}
        >
          .H
        </button>
        <input
          type="text"
          className="fc-exclude-input"
          placeholder="Exclude: *.log, node_modules"
          value={excludeInput}
          onChange={(e) => {
            setExcludeInput(e.target.value);
            _excludeInputCache.set(session.id, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") doCompare();
          }}
          data-tooltip="Exclude patterns (comma or semicolon separated), e.g. .git, node_modules"
        />
        {filteredStats && (
          <span className="fc-stats">
            {filteredStats.modified} diff · {filteredStats.onlyLeft + filteredStats.onlyRight} orphan · {filteredStats.equal} equal
          </span>
        )}
        {copyStatus && <span className="fc-copy-status">{copyStatus}</span>}
      </div>

      {/* Path inputs */}
      <div className="fc-path-bar">
        <div className="fc-path-group">
          <input
            type="text"
            value={leftPath}
            onChange={(e) => setLeftPath(e.target.value)}
            placeholder="Left folder path..."
            className="fc-path-input"
          />
          <button className="icon-btn" onClick={handleSelectLeft} data-tooltip="Browse">
            📂
          </button>
        </div>
        <div className="fc-path-group">
          <input
            type="text"
            value={rightPath}
            onChange={(e) => setRightPath(e.target.value)}
            placeholder="Right folder path..."
            className="fc-path-input"
          />
          <button className="icon-btn" onClick={handleSelectRight} data-tooltip="Browse">
            📂
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="fc-content"
        ref={scrollRef}
        onScroll={() => {
          if (scrollRef.current) _scrollCache.set(session.id, scrollRef.current.scrollTop);
        }}
      >
        {loading && <div className="fc-loading">Comparing...</div>}
        {error && <div className="fc-error">{error}</div>}
        {!loading && !error && !result && <div className="fc-placeholder">Enter left and right paths, then click Compare ▶</div>}
        {!loading && result && visibleItems && (
          <div className="fc-result-table">
            <div className="fc-header-row">
              <div className="fc-name-cell">
                <span className="fc-col-toggle" />
                <span className="fc-col-name">Left</span>
              </div>
              <span className="fc-col-size">Size</span>
              <span className="fc-col-date">Modified</span>
              <span className="fc-col-cmp">⇔</span>
              <div className="fc-name-cell">
                <span className="fc-col-toggle" />
                <span className="fc-col-name">Right</span>
              </div>
              <span className="fc-col-size">Size</span>
              <span className="fc-col-date">Modified</span>
            </div>
            <div className="fc-items">
              {visibleItems.map((item, i) => {
                const depth = item.relativePath.split("/").length - 1;
                const isDir = item.type === "directory";
                const isCollapsed = isDir && collapsedDirs.has(item.relativePath);
                // For directories, aggregate state from file descendants
                const displayState = isDir && result ? computeDirState(item.relativePath, result.items) : item.state;
                const isHiddenItem = item.isHidden;
                const onlyLeft = item.state === "only-left";
                const onlyRight = item.state === "only-right";
                const isOrphan = onlyLeft || onlyRight;
                const indentStyle = { paddingLeft: `${depth * 16}px` };
                const isSelected = selectedPaths.has(item.relativePath);
                // For directories, sizes are computed asynchronously
                const leftDisplaySize = isDir ? dirSizeMap.get(item.relativePath)?.left : item.leftSize;
                const rightDisplaySize = isDir ? dirSizeMap.get(item.relativePath)?.right : item.rightSize;
                // Newer side: only for modified files (both sides exist)
                let newerSide: "left" | "right" | null = null;
                if (item.type === "file" && item.state === "modified" && item.leftDate && item.rightDate) {
                  if (item.leftDate > item.rightDate) newerSide = "left";
                  else if (item.rightDate > item.leftDate) newerSide = "right";
                }

                return (
                  <div
                    key={i}
                    className={`fc-row${isDir ? " fc-row-dir" : ""}${isHiddenItem ? " fc-row-hidden" : ""}${isSelected ? " fc-row-selected" : ""}`}
                    onClick={(e) => handleRowClick(item, e)}
                    onDoubleClick={() => handleDoubleClick(item)}
                  >
                    {/* ── Left name cell ── */}
                    <div className="fc-name-cell" style={indentStyle}>
                      {/* Chevron only on the side that actually has this folder */}
                      <span
                        className="fc-col-toggle"
                        onClick={(e) => {
                          if (isDir && !onlyRight) {
                            e.stopPropagation();
                            toggleCollapse(item.relativePath);
                          }
                        }}
                      >
                        {isDir && !onlyRight ? (isCollapsed ? "▶" : "▼") : ""}
                      </span>
                      {onlyRight ? (
                        <span className="fc-orphan-blank" />
                      ) : (
                        <span
                          className={`fc-col-name${isHiddenItem ? " fc-name-hidden" : ""}${onlyLeft ? " fc-name-orphan" : ""}${newerSide === "left" ? " fc-cell-newer" : ""}`}
                          title={item.name}
                        >
                          {isDir ? "📁 " : ""}
                          {item.name}
                        </span>
                      )}
                    </div>

                    {/* Left size */}
                    <span className={`fc-col-size${newerSide === "left" ? " fc-cell-newer" : ""}`}>
                      {!onlyRight && leftDisplaySize != null ? formatSize(leftDisplaySize) : ""}
                    </span>
                    {/* Left date */}
                    <span className={`fc-col-date${newerSide === "left" ? " fc-cell-newer" : ""}`}>
                      {!onlyRight ? formatDate(item.leftDate) : ""}
                    </span>

                    {/* Center comparison icon — blank for orphan rows (no arrow needed) */}
                    <span className="fc-col-cmp" style={{ color: stateColors[displayState] }}>
                      {isOrphan ? "" : stateIcons[displayState] || "?"}
                    </span>

                    {/* ── Right name cell ── */}
                    <div className="fc-name-cell" style={indentStyle}>
                      {/* Chevron only on the side that actually has this folder */}
                      <span
                        className="fc-col-toggle"
                        onClick={(e) => {
                          if (isDir && !onlyLeft) {
                            e.stopPropagation();
                            toggleCollapse(item.relativePath);
                          }
                        }}
                      >
                        {isDir && !onlyLeft ? (isCollapsed ? "▶" : "▼") : ""}
                      </span>
                      {onlyLeft ? (
                        <span className="fc-orphan-blank" />
                      ) : (
                        <span
                          className={`fc-col-name${isHiddenItem ? " fc-name-hidden" : ""}${onlyRight ? " fc-name-orphan" : ""}${newerSide === "right" ? " fc-cell-newer" : ""}`}
                          title={item.name}
                        >
                          {isDir ? "📁 " : ""}
                          {item.name}
                        </span>
                      )}
                    </div>

                    {/* Right size */}
                    <span className={`fc-col-size${newerSide === "right" ? " fc-cell-newer" : ""}`}>
                      {!onlyLeft && rightDisplaySize != null ? formatSize(rightDisplaySize) : ""}
                    </span>
                    {/* Right date */}
                    <span className={`fc-col-date${newerSide === "right" ? " fc-cell-newer" : ""}`}>
                      {!onlyLeft ? formatDate(item.rightDate) : ""}
                    </span>
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
