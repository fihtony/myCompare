import React, { useState, useCallback, useEffect } from "react";
import type { FolderSession, FolderCompareResult, CompareItem } from "@shared/types";
import { CompareState } from "@shared/types";
import { useSessionStore } from "../store/session-store";
import { log, error as logError } from "../../shared/logger";
import "./FolderCompareView.css";

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
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

/** Check whether any ancestor directory of the given relativePath is in the collapsed set. */
function isAncestorCollapsed(relativePath: string, collapsed: Set<string>): boolean {
  const parts = relativePath.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (collapsed.has(parts.slice(0, i).join("/"))) return true;
  }
  return false;
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
  const [excludeInput, setExcludeInput] = useState(session.excludePatterns.join(", "));
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(true);

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
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        log("FolderCompare", `Exclude patterns: [${patterns.join(", ")}]`);
        updateSession(session.id, { leftPath: lp, rightPath: rp, excludePatterns: patterns } as any);
        const res = await window.electronAPI.compareFolder(lp, rp, patterns);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const handleSelectLeft = async () => {
    const p = await window.electronAPI.dialogSelectFolder();
    if (p) setLeftPath(p);
  };

  const handleSelectRight = async () => {
    const p = await window.electronAPI.dialogSelectFolder();
    if (p) setRightPath(p);
  };

  const handleSwap = () => {
    const newLeft = rightPath;
    const newRight = leftPath;
    setLeftPath(newLeft);
    setRightPath(newRight);
    doCompare(newLeft, newRight);
  };

  const handleDoubleClick = (item: CompareItem) => {
    if (item.type === "file") {
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

  /**
   * Copy changed files from left → right.
   * - modified: overwrite right with left
   * - only-left: create file on right
   * - only-right: leave alone (no deletion)
   * - equal: skip
   */
  const handleCopyToRight = async () => {
    if (!result || !leftPath || !rightPath) return;
    const candidates = result.items.filter((item) => item.type === "file" && (item.state === "modified" || item.state === "only-left"));
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
    const candidates = result.items.filter((item) => item.type === "file" && (item.state === "modified" || item.state === "only-right"));
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

  const filteredItems = result?.items.filter((item) => {
    if (!showHidden) {
      // Hide hidden items themselves
      if (item.isHidden) return false;
      // Hide items inside hidden ancestor directories
      if (isAncestorHidden(item.relativePath)) return false;
    }
    if (session.filterMode === "diff-only" && item.state === "equal") return false;
    return true;
  });

  const visibleItems = filteredItems?.filter((item) => !isAncestorCollapsed(item.relativePath, collapsedDirs));

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
        <button className="icon-btn" onClick={handleCopyToRight} data-tooltip="Copy changed files Left → Right (no deletions)">
          →
        </button>
        <button className="icon-btn" onClick={handleCopyToLeft} data-tooltip="Copy changed files Right → Left (no deletions)">
          ←
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
        <button
          className={`icon-btn${showHidden ? " icon-btn--active" : ""}`}
          onClick={() => setShowHidden((v) => !v)}
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
          onChange={(e) => setExcludeInput(e.target.value)}
          data-tooltip="Exclude patterns (comma-separated)"
        />
        {result && (
          <span className="fc-stats">
            {result.stats.modified} diff · {result.stats.onlyLeft + result.stats.onlyRight} orphan · {result.stats.equal} equal
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
      <div className="fc-content">
        {loading && <div className="fc-loading">Comparing...</div>}
        {error && <div className="fc-error">{error}</div>}
        {!loading && !error && !result && <div className="fc-placeholder">Enter left and right paths, then click Compare ▶</div>}
        {!loading && result && visibleItems && (
          <div className="fc-result-table">
            <div className="fc-header-row">
              <div className="fc-name-cell">
                <span className="fc-col-toggle" />
                <span className="fc-col-state" />
                <span className="fc-col-name">Left</span>
              </div>
              <span className="fc-col-date">Modified</span>
              <span className="fc-col-size">Size</span>
              <span className="fc-col-cmp">⇔</span>
              <div className="fc-name-cell">
                <span className="fc-col-name">Right</span>
              </div>
              <span className="fc-col-date">Modified</span>
              <span className="fc-col-size">Size</span>
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
                const indentStyle = { paddingLeft: `${depth * 16}px` };

                return (
                  <div
                    key={i}
                    className={`fc-row${isDir ? " fc-row-dir" : ""}${isHiddenItem ? " fc-row-hidden" : ""}`}
                    onDoubleClick={() => handleDoubleClick(item)}
                  >
                    {/* ── Left name cell (indented, clips to available space) ── */}
                    <div className="fc-name-cell" style={indentStyle}>
                      {/* Expand/collapse toggle */}
                      <span
                        className="fc-col-toggle"
                        onClick={(e) => {
                          if (isDir) {
                            e.stopPropagation();
                            toggleCollapse(item.relativePath);
                          }
                        }}
                      >
                        {isDir ? (isCollapsed ? "▶" : "▼") : ""}
                      </span>
                      {/* State bar */}
                      <span className="fc-col-state" style={{ background: stateColors[displayState] }} />
                      {/* Filename */}
                      {onlyRight ? (
                        <span className="fc-orphan-side" />
                      ) : (
                        <span className={`fc-col-name${isHiddenItem ? " fc-name-hidden" : ""}`} title={item.name}>
                          {isDir ? "📁 " : ""}
                          {item.name}
                        </span>
                      )}
                    </div>

                    {/* Left date — fixed, not indented */}
                    <span className="fc-col-date">{!onlyRight ? formatDate(item.leftDate) : ""}</span>
                    {/* Left size — fixed, not indented */}
                    <span className="fc-col-size">{!onlyRight && item.leftSize != null ? formatSize(item.leftSize) : ""}</span>

                    {/* Center comparison icon */}
                    <span className="fc-col-cmp" style={{ color: stateColors[displayState] }}>
                      {stateIcons[displayState] || "?"}
                    </span>

                    {/* ── Right name cell (indented for symmetry) ── */}
                    <div className="fc-name-cell" style={indentStyle}>
                      {onlyLeft ? (
                        <span className="fc-orphan-side" />
                      ) : (
                        <span className={`fc-col-name${isHiddenItem ? " fc-name-hidden" : ""}`} title={item.name}>
                          {isDir ? "📁 " : ""}
                          {item.name}
                        </span>
                      )}
                    </div>

                    {/* Right date — fixed, not indented */}
                    <span className="fc-col-date">{!onlyLeft ? formatDate(item.rightDate) : ""}</span>
                    {/* Right size — fixed, not indented */}
                    <span className="fc-col-size">{!onlyLeft && item.rightSize != null ? formatSize(item.rightSize) : ""}</span>
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
