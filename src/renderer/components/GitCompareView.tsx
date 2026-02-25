import React, { useState, useCallback, useEffect } from "react";
import type { GitSession, GitRef, GitCompareResult, CompareState } from "@shared/types";
import { useSessionStore } from "../store/session-store";
import { computeDiff, detectLanguage } from "../utils/diff";
import type { DiffLine } from "../utils/diff";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";
import "./GitCompareView.css";

interface Props {
  session: GitSession;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightLine(text: string, lang: string): string {
  if (!text || lang === "plaintext") return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

const stateIcons: Record<string, string> = {
  equal: "=",
  modified: "≠",
  "only-left": "←",
  "only-right": "→",
  "binary-diff": "⊕",
  error: "!",
};

const stateColors: Record<string, string> = {
  equal: "var(--state-equal)",
  modified: "var(--state-modified)",
  "only-left": "var(--state-only-left)",
  "only-right": "var(--state-only-right)",
  "binary-diff": "var(--state-binary)",
  error: "var(--state-error)",
};

export default function GitCompareView({ session }: Props) {
  const { gitResults, setGitResult, updateSession, createFileSession } = useSessionStore();
  const result = gitResults[session.id];

  const [repoPath, setRepoPath] = useState(session.repoPath);
  const [refs, setRefs] = useState<GitRef[]>([]);
  const [leftRef, setLeftRef] = useState(session.leftRef);
  const [rightRef, setRightRef] = useState(session.rightRef);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);
  const [refFilter, setRefFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [inlineDiffLines, setInlineDiffLines] = useState<DiffLine[]>([]);
  const [inlineDiffLoading, setInlineDiffLoading] = useState(false);

  const loadRefs = useCallback(async (rp: string) => {
    if (!rp) return;
    setRefsLoading(true);
    try {
      const isRepo = await window.electronAPI.gitIsRepo(rp);
      if (!isRepo) {
        setError("Not a Git repository");
        setRefs([]);
        return;
      }
      const r = await window.electronAPI.gitListRefs(rp);
      setRefs(r);
      setError(null);
    } catch (err: any) {
      setError(err.message);
      setRefs([]);
    } finally {
      setRefsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session.repoPath) {
      loadRefs(session.repoPath);
    }
  }, [session.repoPath]);

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
    setError(null);
    try {
      updateSession(session.id, { repoPath, leftRef, rightRef } as any);
      const res = await window.electronAPI.compareGit(repoPath, leftRef, rightRef);
      setGitResult(session.id, res);
      const repoName = repoPath.split("/").pop() || repoPath;
      updateSession(session.id, { name: `${repoName} (${leftRef} ↔ ${rightRef})` });
    } catch (err: any) {
      setError(err.message || "Git compare failed");
    } finally {
      setLoading(false);
    }
  }, [repoPath, leftRef, rightRef, session.id]);

  const handleSwap = () => {
    setLeftRef(rightRef);
    setRightRef(leftRef);
  };

  const handleDoubleClick = async (filePath: string) => {
    if (!repoPath || !leftRef || !rightRef) return;
    try {
      const leftTmp = await window.electronAPI.gitExtractFile(repoPath, leftRef, filePath);
      const rightTmp = await window.electronAPI.gitExtractFile(repoPath, rightRef, filePath);
      createFileSession(leftTmp, rightTmp, session.id);
    } catch (err: any) {
      setError(`Failed to extract file: ${err.message}`);
    }
  };

  /** Single-click: load diff inline below the file list. */
  const handleClickFile = useCallback(
    async (filePath: string) => {
      if (selectedFile === filePath) {
        // Toggle off
        setSelectedFile(null);
        setInlineDiffLines([]);
        return;
      }
      setSelectedFile(filePath);
      setInlineDiffLoading(true);
      try {
        const [leftTmp, rightTmp] = await Promise.all([
          window.electronAPI.gitExtractFile(repoPath, leftRef, filePath),
          window.electronAPI.gitExtractFile(repoPath, rightRef, filePath),
        ]);
        const [leftContent, rightContent] = await Promise.all([
          window.electronAPI.fileRead(leftTmp),
          window.electronAPI.fileRead(rightTmp),
        ]);
        setInlineDiffLines(computeDiff(leftContent.split("\n"), rightContent.split("\n")));
      } catch (err: any) {
        setError(`Failed to load diff: ${err.message}`);
        setInlineDiffLines([]);
      } finally {
        setInlineDiffLoading(false);
      }
    },
    [repoPath, leftRef, rightRef, selectedFile],
  );

  const branches = refs.filter((r) => r.type === "branch");
  const tags = refs.filter((r) => r.type === "tag");
  const commits = refs.filter((r) => r.type === "commit");

  const filteredRefs = refs.filter((r) => (refFilter ? r.name.toLowerCase().includes(refFilter.toLowerCase()) : true));

  const filteredItems = result?.items.filter((item) => {
    if (session.filterMode === "diff-only") return item.state !== "equal";
    return true;
  });

  const toggleFilter = () => {
    const store = useSessionStore.getState();
    store.setFilterMode(session.id, session.filterMode === "all" ? "diff-only" : "all");
  };

  return (
    <div className="git-compare">
      {/* Toolbar */}
      <div className="gc-toolbar">
        <button className="icon-btn" onClick={handleSwap} data-tooltip="Swap Refs">
          ⇄
        </button>
        <button className="icon-btn" onClick={doCompare} data-tooltip="Compare (⌘R)">
          ▶
        </button>
        <button className="icon-btn" onClick={() => loadRefs(repoPath)} data-tooltip="Refresh Refs">
          ↻
        </button>
        <div className="toolbar-sep" />
        <button
          className="icon-btn"
          onClick={toggleFilter}
          data-tooltip={session.filterMode === "all" ? "Show Differences Only" : "Show All"}
          style={{ color: session.filterMode === "diff-only" ? "var(--accent)" : undefined }}
        >
          ⚬
        </button>
        {result && (
          <span className="gc-stats">
            {result.stats.modified} modified · {result.stats.onlyLeft + result.stats.onlyRight} added/removed · {result.stats.total} total
          </span>
        )}
      </div>

      {/* Repo path & ref selectors */}
      <div className="gc-path-bar">
        <div className="gc-repo-group">
          <span className="gc-label">Repo:</span>
          <input
            type="text"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            onBlur={() => loadRefs(repoPath)}
            placeholder="Git repository path..."
            className="gc-repo-input"
          />
          <button className="icon-btn" onClick={handleSelectRepo} data-tooltip="Browse">
            📂
          </button>
        </div>
        <div className="gc-ref-selectors">
          <div className="gc-ref-group">
            <span className="gc-label">Left:</span>
            <select className="gc-ref-select" value={leftRef} onChange={(e) => setLeftRef(e.target.value)}>
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
          </div>
          <div className="gc-ref-group">
            <span className="gc-label">Right:</span>
            <select className="gc-ref-select" value={rightRef} onChange={(e) => setRightRef(e.target.value)}>
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
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="gc-content">
        {loading && <div className="gc-loading">Comparing...</div>}
        {refsLoading && <div className="gc-loading">Loading refs...</div>}
        {error && <div className="gc-error">{error}</div>}
        {!loading && !error && !result && <div className="gc-placeholder">Select a repository and two refs, then click Compare ▶</div>}
        {!loading && result && filteredItems && (
          <div className="gc-split-pane">
            <div className="gc-result-table">
              <div className="gc-header-row">
                <span className="gc-col-state"></span>
                <span className="gc-col-path">File Path</span>
                <span className="gc-col-status">Status</span>
              </div>
              <div className="gc-items">
                {filteredItems.map((item, i) => (
                  <div
                    key={i}
                    className={`gc-row${selectedFile === item.relativePath ? " gc-row-selected" : ""}`}
                    onClick={() => item.state !== "equal" && handleClickFile(item.relativePath)}
                    onDoubleClick={() => handleDoubleClick(item.relativePath)}
                    title="Click to preview diff · Double-click to open full diff tab"
                  >
                    <span className="gc-col-state" style={{ background: stateColors[item.state] }} />
                    <span className="gc-col-path" style={{ color: stateColors[item.state] }}>
                      {item.relativePath}
                    </span>
                    <span className="gc-col-status">{stateIcons[item.state] || "?"}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Inline diff pane — shows when a file is selected */}
            {(selectedFile || inlineDiffLoading) && (
              <div className="gc-inline-diff">
                <div className="gc-inline-diff-header">
                  <span>{selectedFile}</span>
                  <span className="gc-inline-hint">Double-click row to open full diff tab</span>
                  <button
                    className="icon-btn"
                    onClick={() => {
                      setSelectedFile(null);
                      setInlineDiffLines([]);
                    }}
                    title="Close preview"
                  >
                    ✕
                  </button>
                </div>
                {inlineDiffLoading ? (
                  <div className="gc-inline-loading">Loading diff…</div>
                ) : (
                  <div className="gc-inline-scroll">
                    {inlineDiffLines.map((line, i) => {
                      const lang = detectLanguage(selectedFile ?? "");
                      const isModified = line.type === "modified" || line.type === "whitespace";
                      const leftHtml =
                        isModified && line.leftSpans
                          ? line.leftSpans
                              .map((s) => (s.changed ? `<mark class="gc-char-del">${escapeHtml(s.text)}</mark>` : escapeHtml(s.text)))
                              .join("")
                          : line.leftText
                            ? highlightLine(line.leftText, lang)
                            : "";
                      const rightHtml =
                        isModified && line.rightSpans
                          ? line.rightSpans
                              .map((s) => (s.changed ? `<mark class="gc-char-ins">${escapeHtml(s.text)}</mark>` : escapeHtml(s.text)))
                              .join("")
                          : line.rightText
                            ? highlightLine(line.rightText, lang)
                            : "";
                      return (
                        <div key={i} className={`gc-diff-row gc-diff-${line.type}`}>
                          <span className="gc-diff-lineno">{line.leftLineNo ?? ""}</span>
                          <div
                            className={`gc-diff-cell gc-diff-left${isModified ? " gc-diff-mod-left" : ""}`}
                            dangerouslySetInnerHTML={{ __html: leftHtml }}
                          />
                          <div className="gc-diff-sep" />
                          <div
                            className={`gc-diff-cell gc-diff-right${isModified ? " gc-diff-mod-right" : ""}`}
                            dangerouslySetInnerHTML={{ __html: rightHtml }}
                          />
                          <span className="gc-diff-lineno">{line.rightLineNo ?? ""}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
