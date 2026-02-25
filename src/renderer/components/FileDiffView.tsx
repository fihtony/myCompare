import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { FileSession, FileStatInfo } from "@shared/types";
import { useSessionStore } from "../store/session-store";
import { computeDiff, detectLanguage, computeCharDiff } from "../utils/diff";
import type { DiffLine } from "../utils/diff";
import HexDiffView from "./HexDiffView";
import { log, error as logError } from "../../shared/logger";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";
import "./FileDiffView.css";

interface Props {
  session: FileSession;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

function highlightLine(text: string, lang: string): string {
  if (!text || lang === "plaintext") return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

function ThumbnailStrip({ data }: { data: string[] }) {
  return (
    <div className="fd-thumbnail">
      {data.map((color, i) => (
        <div
          key={i}
          className="fd-thumb-line"
          style={{ background: color }}
          onClick={() => document.getElementById(`diff-row-${i}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
        />
      ))}
    </div>
  );
}

export default function FileDiffView({ session }: Props) {
  const { updateSession } = useSessionStore();
  const [leftContent, setLeftContent] = useState<string>("");
  const [rightContent, setRightContent] = useState<string>("");
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftPath, setLeftPath] = useState(session.leftPath);
  const [rightPath, setRightPath] = useState(session.rightPath);
  const [currentDiffIdx, setCurrentDiffIdx] = useState(-1);
  const [isBinary, setIsBinary] = useState(false);
  const [syntaxOn, setSyntaxOn] = useState(true);
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [leftStat, setLeftStat] = useState<FileStatInfo | null>(null);
  const [rightStat, setRightStat] = useState<FileStatInfo | null>(null);
  /** Undo stack: each entry is a snapshot of {leftContent, rightContent} before an edit. */
  const undoStackRef = useRef<Array<{ lc: string; rc: string }>>([]);
  /** Increment to force full remount of the diff table (after file load or inline edit commit). */
  const [tableKey, setTableKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Reconstruct left file content from current diffLines (excludes "added" rows which are right-only) */
  const reconstructLeft = (lines: DiffLine[]) =>
    lines
      .filter((d) => d.type !== "added")
      .map((d) => d.leftText)
      .join("\n");

  /** Reconstruct right file content from current diffLines (excludes "removed" rows which are left-only) */
  const reconstructRight = (lines: DiffLine[]) =>
    lines
      .filter((d) => d.type !== "removed")
      .map((d) => d.rightText)
      .join("\n");

  /** Save a snapshot of current content to the undo stack before any mutation. */
  const pushUndo = () => {
    undoStackRef.current.push({ lc: leftContent, rc: rightContent });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
  };

  /** Revert the last edit operation. */
  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    const { lc, rc } = prev;
    setLeftContent(lc);
    setRightContent(rc);
    setDiffLines(computeDiff(lc.split("\n"), rc.split("\n")));
    setTableKey((k) => k + 1);
    setLeftDirty(true);
    setRightDirty(true);
  }, []);

  /** Contiguous groups of non-equal diff lines, plus a row→group index map. */
  const { groups, rowGroupIdx } = useMemo(() => {
    const groups: number[][] = [];
    const rowGroupIdx = new Array<number>(diffLines.length).fill(-1);
    let i = 0;
    while (i < diffLines.length) {
      if (diffLines[i].type !== "equal") {
        const gi = groups.length;
        const indices: number[] = [];
        while (i < diffLines.length && diffLines[i].type !== "equal") {
          indices.push(i);
          rowGroupIdx[i] = gi;
          i++;
        }
        groups.push(indices);
      } else {
        i++;
      }
    }
    return { groups, rowGroupIdx };
  }, [diffLines]);

  /**
   * Commit an inline edit for one line and recompute the diff.
   * Called on contentEditable blur when the text has actually changed.
   */
  const handleInlineEdit = useCallback(
    (side: "left" | "right", lineIdx: number, newText: string) => {
      pushUndo();
      const updated = diffLines.map((d, i) =>
        i !== lineIdx ? d : side === "left" ? { ...d, leftText: newText } : { ...d, rightText: newText },
      );
      const newLeft = reconstructLeft(updated);
      const newRight = reconstructRight(updated);
      if (side === "left") {
        setLeftContent(newLeft);
        setLeftDirty(true);
      } else {
        setRightContent(newRight);
        setRightDirty(true);
      }
      setDiffLines(computeDiff(newLeft.split("\n"), newRight.split("\n")));
      setTableKey((k) => k + 1);
    },
    [diffLines],
  );

  const lang = useMemo(() => detectLanguage(leftPath || rightPath), [leftPath, rightPath]);

  const loadAndCompare = useCallback(async (lp: string, rp: string) => {
    if (!lp && !rp) return;
    setLoading(true);
    setError(null);
    setLeftDirty(false);
    setRightDirty(false);
    log("FileDiff", `Loading files: "${lp}" vs "${rp}"`);
    try {
      // One-sided view: only one path provided (e.g. file only-left or only-right from folder compare)
      if (!lp || !rp) {
        const existingPath = (lp || rp) as string;
        const isBin = await window.electronAPI.fileDetectBinary(existingPath);
        if (isBin) {
          setIsBinary(true);
          setDiffLines([]);
          setLeftContent("");
          setRightContent("");
          return;
        }
        setIsBinary(false);
        const content = await window.electronAPI.fileRead(existingPath);
        if (lp) {
          setLeftContent(content);
          setRightContent("");
          setDiffLines(computeDiff(content.split("\n"), []));
        } else {
          setRightContent(content);
          setLeftContent("");
          setDiffLines(computeDiff([], content.split("\n")));
        }
        setTableKey((k) => k + 1);
        return;
      }
      const [leftBin, rightBin] = await Promise.all([window.electronAPI.fileDetectBinary(lp), window.electronAPI.fileDetectBinary(rp)]);
      log("FileDiff", `Binary detection: left=${leftBin ? "binary" : "text"}, right=${rightBin ? "binary" : "text"}`);
      if (leftBin || rightBin) {
        setIsBinary(true);
        setDiffLines([]);
        setLeftContent("");
        setRightContent("");
        return;
      }
      setIsBinary(false);
      const [left, right] = await Promise.all([window.electronAPI.fileRead(lp), window.electronAPI.fileRead(rp)]);
      setLeftContent(left);
      setRightContent(right);
      const diffResult = computeDiff(left.split("\n"), right.split("\n"));
      log(
        "FileDiff",
        `Diff computed: ${diffResult.length} lines (${diffResult.filter((d) => d.type === "add").length} added, ${diffResult.filter((d) => d.type === "remove").length} removed)`,
      );
      setDiffLines(diffResult);
      setTableKey((k) => k + 1);
      // Load file stats (best-effort, don't fail the whole load)
      try {
        const [ls, rs] = await Promise.all([window.electronAPI.fileStat(lp), window.electronAPI.fileStat(rp)]);
        setLeftStat(ls);
        setRightStat(rs);
      } catch {
        setLeftStat(null);
        setRightStat(null);
      }
    } catch (err: any) {
      const msg = err.message || "Failed to load files";
      logError("FileDiff", msg, err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session.leftPath && session.rightPath) {
      setLeftPath(session.leftPath);
      setRightPath(session.rightPath);
      loadAndCompare(session.leftPath, session.rightPath);
    }
  }, [session.leftPath, session.rightPath]);

  // Ctrl+Z / Cmd+Z undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        // Only intercept if focus is not inside a contentEditable (let browser handle there)
        const active = document.activeElement;
        if (active && (active as HTMLElement).contentEditable === "plaintext-only") return;
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo]);

  const handleCompare = () => {
    updateSession(session.id, { leftPath, rightPath } as any);
    updateSession(session.id, { name: leftPath.split("/").pop() || "File Compare" } as any);
    loadAndCompare(leftPath, rightPath);
  };

  const handleSelectLeft = async () => {
    const p = await window.electronAPI.dialogSelectFile();
    if (p) setLeftPath(p);
  };

  const handleSelectRight = async () => {
    const p = await window.electronAPI.dialogSelectFile();
    if (p) setRightPath(p);
  };

  const handleSaveLeft = async () => {
    try {
      await window.electronAPI.fileWrite(leftPath, leftContent);
      setLeftDirty(false);
      log("FileDiff", `Saved left: ${leftPath}`);
    } catch (err: any) {
      logError("FileDiff", `Save left failed: ${err.message}`, err);
    }
  };

  const handleSaveRight = async () => {
    try {
      await window.electronAPI.fileWrite(rightPath, rightContent);
      setRightDirty(false);
      log("FileDiff", `Saved right: ${rightPath}`);
    } catch (err: any) {
      logError("FileDiff", `Save right failed: ${err.message}`, err);
    }
  };

  /** Stage all left content into right — does NOT write to disk until Save is clicked */
  const handleCopyLeftToRight = () => {
    pushUndo();
    setRightContent(leftContent);
    setRightDirty(true);
    setDiffLines(computeDiff(leftContent.split("\n"), leftContent.split("\n")));
  };

  /** Stage all right content into left — does NOT write to disk until Save is clicked */
  const handleCopyRightToLeft = () => {
    pushUndo();
    setLeftContent(rightContent);
    setLeftDirty(true);
    setDiffLines(computeDiff(rightContent.split("\n"), rightContent.split("\n")));
  };

  /** Copy single diff line's left text to the right side */
  const copyLineToRight = (idx: number) => {
    pushUndo();
    const newLines = diffLines.map((d, i) => (i === idx ? { ...d, type: "equal" as const, rightText: d.leftText } : d));
    setDiffLines(newLines);
    setRightContent(reconstructRight(newLines));
    setRightDirty(true);
  };

  /** Copy single diff line's right text to the left side */
  const copyLineToLeft = (idx: number) => {
    pushUndo();
    const newLines = diffLines.map((d, i) => (i === idx ? { ...d, type: "equal" as const, leftText: d.rightText } : d));
    setDiffLines(newLines);
    setLeftContent(reconstructLeft(newLines));
    setLeftDirty(true);
  };

  /** Copy an entire contiguous diff group (section) to the right side. */
  const copyGroupToRight = (groupIdx: number) => {
    pushUndo();
    const groupSet = new Set(groups[groupIdx]);
    const newRight: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      if (!groupSet.has(i)) {
        if (line.type !== "removed") newRight.push(line.rightText);
      } else {
        if (line.type === "removed")
          newRight.push(line.leftText); // add to right
        else if (line.type === "added") {
          /* skip — delete from right */
        } else {
          newRight.push(line.leftText); // modified/whitespace: use left
        }
      }
    }
    const newRc = newRight.join("\n");
    setRightContent(newRc);
    setRightDirty(true);
    setDiffLines(computeDiff(leftContent.split("\n"), newRc.split("\n")));
    setTableKey((k) => k + 1);
  };

  /** Copy an entire contiguous diff group (section) to the left side. */
  const copyGroupToLeft = (groupIdx: number) => {
    pushUndo();
    const groupSet = new Set(groups[groupIdx]);
    const newLeft: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      if (!groupSet.has(i)) {
        if (line.type !== "added") newLeft.push(line.leftText);
      } else {
        if (line.type === "added")
          newLeft.push(line.rightText); // add to left
        else if (line.type === "removed") {
          /* skip — delete from left */
        } else {
          newLeft.push(line.rightText); // modified/whitespace: use right
        }
      }
    }
    const newLc = newLeft.join("\n");
    setLeftContent(newLc);
    setLeftDirty(true);
    setDiffLines(computeDiff(newLc.split("\n"), rightContent.split("\n")));
    setTableKey((k) => k + 1);
  };

  const diffIndices = diffLines.map((d, i) => (d.type !== "equal" ? i : -1)).filter((i) => i >= 0);
  const diffCount = diffIndices.length;

  const goNext = () => {
    if (!diffIndices.length) return;
    const next = diffIndices.find((i) => i > currentDiffIdx) ?? diffIndices[0];
    setCurrentDiffIdx(next);
    document.getElementById(`diff-row-${next}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const goPrev = () => {
    if (!diffIndices.length) return;
    const prev = [...diffIndices].reverse().find((i) => i < currentDiffIdx) ?? diffIndices[diffIndices.length - 1];
    setCurrentDiffIdx(prev);
    document.getElementById(`diff-row-${prev}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const thumbnailData = diffLines.map((d) => {
    if (d.type === "added") return "var(--diff-added-line)";
    if (d.type === "removed") return "var(--diff-removed-line)";
    if (d.type === "modified") return "var(--diff-modified-line)";
    if (d.type === "whitespace") return "var(--diff-whitespace-line, #5b8dd9)";
    return "transparent";
  });

  return (
    <div className="file-diff">
      {/* Toolbar */}
      <div className="fd-toolbar">
        <button
          className="icon-btn"
          onClick={() => {
            // Swap paths and in-memory content, preserving unsaved edits
            const nl = rightPath,
              nr = leftPath;
            const nlc = rightContent,
              nrc = leftContent;
            const nld = rightDirty,
              nrd = leftDirty;
            const nls = rightStat,
              nrs = leftStat;
            setLeftPath(nl);
            setRightPath(nr);
            setLeftContent(nlc);
            setRightContent(nrc);
            setLeftDirty(nld);
            setRightDirty(nrd);
            setLeftStat(nls);
            setRightStat(nrs);
            setDiffLines(computeDiff(nlc.split("\n"), nrc.split("\n")));
            setTableKey((k) => k + 1);
          }}
          data-tooltip="Swap Sides (preserves unsaved changes)"
        >
          ⇄
        </button>
        <button className="icon-btn" onClick={handleCompare} data-tooltip="Recompare (⌘R)">
          ↻
        </button>
        <button className="icon-btn" onClick={handleUndo} data-tooltip="Undo last edit (⌘Z)" disabled={undoStackRef.current.length === 0}>
          ↩
        </button>
        <div className="toolbar-sep" />
        <button className="icon-btn" onClick={goPrev} data-tooltip="Previous Diff (⇧F3)" disabled={diffCount === 0}>
          ↑
        </button>
        <button className="icon-btn" onClick={goNext} data-tooltip="Next Diff (F3)" disabled={diffCount === 0}>
          ↓
        </button>
        <div className="toolbar-sep" />
        <button className="icon-btn" onClick={handleCopyLeftToRight} data-tooltip="Copy All Left → Right (stages, no save)">
          →
        </button>
        <button className="icon-btn" onClick={handleCopyRightToLeft} data-tooltip="Copy All Right → Left (stages, no save)">
          ←
        </button>
        <div className="toolbar-sep" />
        <button
          className="icon-btn"
          onClick={() => setSyntaxOn((v) => !v)}
          style={{ color: syntaxOn ? "var(--accent)" : undefined }}
          data-tooltip={syntaxOn ? "Disable Syntax Highlight" : "Enable Syntax Highlight"}
        >
          ✨
        </button>
        {isBinary && <span className="fd-binary-badge">Binary</span>}
        {diffCount > 0 && <span className="fd-stats">{diffCount} differences</span>}
      </div>

      {/* Path bar */}
      <div className="fd-path-bar">
        <div className="fd-path-group">
          <input
            type="text"
            value={leftPath}
            onChange={(e) => setLeftPath(e.target.value)}
            placeholder="Left file…"
            className="fd-path-input"
          />
          {leftDirty && (
            <span className="fd-dirty-indicator" title="Unsaved changes">
              *
            </span>
          )}
          <button className="icon-btn" onClick={handleSelectLeft} data-tooltip="Browse">
            📂
          </button>
          <button
            className={`icon-btn fd-save-btn${leftDirty ? " fd-save-active" : ""}`}
            onClick={handleSaveLeft}
            disabled={!leftDirty}
            data-tooltip="Save Left"
          >
            💾
          </button>
        </div>
        <div className="fd-path-group">
          <input
            type="text"
            value={rightPath}
            onChange={(e) => setRightPath(e.target.value)}
            placeholder="Right file…"
            className="fd-path-input"
          />
          {rightDirty && (
            <span className="fd-dirty-indicator" title="Unsaved changes">
              *
            </span>
          )}
          <button className="icon-btn" onClick={handleSelectRight} data-tooltip="Browse">
            📂
          </button>
          <button
            className={`icon-btn fd-save-btn${rightDirty ? " fd-save-active" : ""}`}
            onClick={handleSaveRight}
            disabled={!rightDirty}
            data-tooltip="Save Right"
          >
            💾
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="fd-content">
        {loading && <div className="fd-loading">Loading…</div>}
        {error && <div className="fd-error">{error}</div>}

        {!loading && !error && isBinary && <HexDiffView leftPath={leftPath} rightPath={rightPath} />}

        {!loading && !error && !isBinary && diffLines.length === 0 && !leftContent && (
          <div className="fd-placeholder">Enter file paths and click Recompare ↻</div>
        )}

        {!loading && !error && !isBinary && diffLines.length > 0 && (
          <div className="fd-diff-container">
            <ThumbnailStrip data={thumbnailData} />

            <div className="fd-diff-scroll" ref={scrollRef}>
              <div className="fd-diff-table" key={tableKey}>
                {diffLines.map((line, i) => {
                  const isModified = line.type === "modified" || line.type === "whitespace";
                  const isWhitespace = line.type === "whitespace";
                  const canEditLeft = line.type !== "added";
                  const canEditRight = line.type !== "removed";
                  // Group copy: only show at the first row of each group
                  const gi = rowGroupIdx[i];
                  const isGroupFirst = gi >= 0 && groups[gi][0] === i;
                  const isGroupLast = gi >= 0 && groups[gi][groups[gi].length - 1] === i;

                  // Build HTML for a cell, handling whitespace-visible chars in whitespace-type rows
                  const renderCellHtml = (text: string, spans: typeof line.leftSpans, isLeft: boolean) => {
                    if (isWhitespace && spans) {
                      return spans
                        .map((s) => {
                          const safe = escapeHtml(s.text)
                            .replace(/ /g, '<span class="fd-ws-dot">·</span>')
                            .replace(/\t/g, '<span class="fd-ws-dot">→</span>');
                          return s.changed ? `<mark class="fd-char-ws">${safe}</mark>` : safe;
                        })
                        .join("");
                    }
                    if (isModified && spans) {
                      return spans
                        .map((s) =>
                          s.changed
                            ? `<mark class="${isLeft ? "fd-char-del" : "fd-char-ins"}">${escapeHtml(s.text)}</mark>`
                            : escapeHtml(s.text),
                        )
                        .join("");
                    }
                    return syntaxOn && text ? highlightLine(text, lang) : escapeHtml(text);
                  };

                  return (
                    <div
                      key={i}
                      id={`diff-row-${i}`}
                      className={`fd-diff-row fd-diff-${line.type}${i === currentDiffIdx ? " fd-diff-active" : ""}${isGroupFirst ? " fd-group-first" : ""}${isGroupLast ? " fd-group-last" : ""}`}
                    >
                      {/* Left line number */}
                      <span className="fd-line-no">{line.leftLineNo ?? ""}</span>

                      {/* Left text — contentEditable for inline editing */}
                      <div
                        key={`${tableKey}-${i}-l`}
                        className={`fd-line-text fd-line-left${isModified ? " fd-line-modified-left" : ""}`}
                        contentEditable={canEditLeft ? "plaintext-only" : undefined}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onBlur={
                          canEditLeft
                            ? (e) => {
                                const newText = e.currentTarget.textContent ?? "";
                                if (newText !== line.leftText) handleInlineEdit("left", i, newText);
                              }
                            : undefined
                        }
                        dangerouslySetInnerHTML={{ __html: renderCellHtml(line.leftText, line.leftSpans, true) }}
                      />

                      {/* Copy-to-right: line copy (always present) + group copy at group start */}
                      <div className="fd-copy-col">
                        {line.type !== "equal" && (
                          <button
                            className="fd-line-copy fd-line-copy-right"
                            onClick={() => copyLineToRight(i)}
                            title="→ Copy this line to right"
                            tabIndex={-1}
                          >
                            ›
                          </button>
                        )}
                        {isGroupFirst && groups[gi].length > 1 && (
                          <button
                            className="fd-group-copy fd-group-copy-right"
                            onClick={() => copyGroupToRight(gi)}
                            title={`⇥ Copy all ${groups[gi].length} lines of this section to right`}
                            tabIndex={-1}
                          >
                            »
                          </button>
                        )}
                      </div>

                      <span className="fd-gutter" />

                      {/* Copy-to-left: group copy at group start + line copy */}
                      <div className="fd-copy-col fd-copy-col-left">
                        {isGroupFirst && groups[gi].length > 1 && (
                          <button
                            className="fd-group-copy fd-group-copy-left"
                            onClick={() => copyGroupToLeft(gi)}
                            title={`⇤ Copy all ${groups[gi].length} lines of this section to left`}
                            tabIndex={-1}
                          >
                            «
                          </button>
                        )}
                        {line.type !== "equal" && (
                          <button
                            className="fd-line-copy fd-line-copy-left"
                            onClick={() => copyLineToLeft(i)}
                            title="← Copy this line to left"
                            tabIndex={-1}
                          >
                            ‹
                          </button>
                        )}
                      </div>

                      {/* Right line number */}
                      <span className="fd-line-no">{line.rightLineNo ?? ""}</span>

                      {/* Right text — contentEditable for inline editing */}
                      <div
                        key={`${tableKey}-${i}-r`}
                        className={`fd-line-text fd-line-right${isModified ? " fd-line-modified-right" : ""}`}
                        contentEditable={canEditRight ? "plaintext-only" : undefined}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onBlur={
                          canEditRight
                            ? (e) => {
                                const newText = e.currentTarget.textContent ?? "";
                                if (newText !== line.rightText) handleInlineEdit("right", i, newText);
                              }
                            : undefined
                        }
                        dangerouslySetInnerHTML={{ __html: renderCellHtml(line.rightText, line.rightSpans, false) }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <ThumbnailStrip data={thumbnailData} />
          </div>
        )}
      </div>

      {/* Footbar — file metadata */}
      {(leftContent || rightContent) && (
        <div className="fd-footbar">
          <div className="fd-foot-side">
            {leftStat ? (
              <>
                <span>{formatSize(leftStat.size)}</span>
                <span className="fd-foot-sep">·</span>
                <span>{leftContent.split("\n").length} lines</span>
                <span className="fd-foot-sep">·</span>
                <span title="Modified">{formatDate(leftStat.mtime)}</span>
                {leftStat.birthtime !== leftStat.mtime && (
                  <span title={`Created ${formatDate(leftStat.birthtime)}`} className="fd-foot-muted">
                    {" "}
                    ({formatDate(leftStat.birthtime)} created)
                  </span>
                )}
                {leftStat.readonly && <span className="fd-foot-badge">RO</span>}
                {leftStat.hidden && <span className="fd-foot-badge">Hidden</span>}
              </>
            ) : (
              <span className="fd-foot-muted">{leftContent.split("\n").length} lines</span>
            )}
          </div>
          <div className="fd-foot-center">
            {diffCount > 0 && (
              <span>
                {diffCount} difference{diffCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="fd-foot-side fd-foot-right">
            {rightStat ? (
              <>
                {rightStat.readonly && <span className="fd-foot-badge">RO</span>}
                {rightStat.hidden && <span className="fd-foot-badge">Hidden</span>}
                <span title="Modified">{formatDate(rightStat.mtime)}</span>
                <span className="fd-foot-sep">·</span>
                <span>{rightContent.split("\n").length} lines</span>
                <span className="fd-foot-sep">·</span>
                <span>{formatSize(rightStat.size)}</span>
              </>
            ) : (
              <span className="fd-foot-muted">{rightContent.split("\n").length} lines</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
