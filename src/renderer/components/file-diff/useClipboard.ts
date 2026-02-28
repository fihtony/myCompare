/**
 * Hook for text-selection isolation and clipboard copy/paste.
 *
 * Bug fix (vs original):
 * - Copy now works for keyboard-selected text (Shift+End, Shift+Arrow, etc.)
 *   by detecting the selection side from DOM ancestry instead of relying
 *   solely on the fd-selecting-left/right CSS class set by mousedown.
 */
import { useCallback, useEffect } from "react";
import type React from "react";

export function useClipboard(tableDivRef: React.RefObject<HTMLDivElement | null>) {
  /**
   * Mark which column the user started a text-selection drag on.
   * Adds a CSS class so the opposite column is hidden from browser selection.
   * Note: handleCopy no longer requires this class to be present — it is kept
   * for the CSS user-select:none trick to prevent cross-column selection blur.
   */
  const startTextSelect = useCallback(
    (side: "left" | "right") => {
      const el = tableDivRef.current;
      if (!el) return;
      el.classList.remove("fd-selecting-left", "fd-selecting-right");
      el.classList.add(`fd-selecting-${side}`);
    },
    [tableDivRef],
  );

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      console.log("[Clipboard] copy event fired", {
        hasSelection: !!sel,
        isCollapsed: sel?.isCollapsed,
        rangeCount: sel?.rangeCount,
        tableDivRef: !!tableDivRef.current,
        selString: sel?.toString().slice(0, 80),
      });
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        console.log("[Clipboard] early-exit: no selection");
        return;
      }
      const tableEl = tableDivRef.current;
      if (!tableEl) {
        console.log("[Clipboard] early-exit: tableDivRef.current is null");
        return;
      }
      // Ignore copy events unrelated to our diff table
      const anchorInTable = tableEl.contains(sel.anchorNode);
      console.log("[Clipboard] anchorInTable:", anchorInTable, "anchorNode:", sel.anchorNode?.nodeName);
      if (!anchorInTable) {
        console.log("[Clipboard] early-exit: selection anchor not inside table");
        return;
      }

      const range = sel.getRangeAt(0);

      // ── Determine which side (left/right) the selection lives in ──────────
      // Walk up from the selection's anchor node to find fd-line-left/right.
      // This works for both mouse and keyboard selections, fixing the bug where
      // keyboard-selected text didn't trigger a side detection via mousedown.
      let side: "left" | "right" | null = null;
      let node: Node | null = range.startContainer;
      while (node && node !== tableEl) {
        if (node instanceof Element) {
          if (node.classList.contains("fd-line-left")) {
            side = "left";
            break;
          }
          if (node.classList.contains("fd-line-right")) {
            side = "right";
            break;
          }
        }
        node = node.parentNode;
      }
      // Fallback: check CSS class left by the mousedown handler
      if (!side) {
        if (tableEl.classList.contains("fd-selecting-left")) side = "left";
        else if (tableEl.classList.contains("fd-selecting-right")) side = "right";
      }
      console.log("[Clipboard] detected side:", side, "tableEl classes:", tableEl.className);
      // Cannot determine side — let browser handle copy natively
      if (!side) {
        console.log("[Clipboard] early-exit: cannot determine side");
        return;
      }

      const sideClass = side === "left" ? ".fd-line-left" : ".fd-line-right";
      const cells = Array.from(tableEl.querySelectorAll(sideClass)) as HTMLElement[];
      console.log("[Clipboard] cells found:", cells.length, "using selector:", sideClass);

      // ── Collect text from every cell that overlaps the selection ─────────
      // compareBoundaryPoints(HOW, sourceRange) semantics (W3C):
      //   START_TO_END  → compares range.end   with sourceRange.start
      //   END_TO_START  → compares range.start with sourceRange.end
      //   < 0  → first point is before second; >= 0 → at or after
      //
      // Iterating cells in DOM order (top→bottom):
      //   END_TO_START >= 0: range.start >= cellRange.end
      //     → this cell ends before/at the selection start → cell is BEFORE selection → continue (skip)
      //   START_TO_END <= 0: range.end <= cellRange.start
      //     → this cell starts after/at the selection end  → cell is AFTER selection  → break (stop)
      //   Otherwise: cell overlaps the selection → include
      const lines: string[] = [];
      for (const cell of cells) {
        const cellRange = document.createRange();
        cellRange.selectNodeContents(cell);
        try {
          // Cell is entirely before the selection — skip and keep going.
          if (range.compareBoundaryPoints(Range.END_TO_START, cellRange) >= 0) continue;
          // Cell starts at or after the selection end — no more cells to collect.
          if (range.compareBoundaryPoints(Range.START_TO_END, cellRange) <= 0) break;
        } catch {
          continue;
        }
        // Intersect the selection range with this cell.
        const intersect = range.cloneRange();
        try {
          if (range.compareBoundaryPoints(Range.START_TO_START, cellRange) < 0)
            intersect.setStart(cellRange.startContainer, cellRange.startOffset);
          if (range.compareBoundaryPoints(Range.END_TO_END, cellRange) > 0) intersect.setEnd(cellRange.endContainer, cellRange.endOffset);
        } catch {
          lines.push(cell.textContent ?? "");
          continue;
        }
        lines.push(intersect.toString());
      }

      console.log("[Clipboard] collected lines:", lines.length, lines.slice(0, 5));

      if (lines.length > 0) {
        const text = lines.join("\n");
        // Prevent the browser from copying the raw HTML selection
        e.preventDefault();
        // 1) Write via clipboardData (synchronous, works in standard Chromium)
        e.clipboardData?.setData("text/plain", text);
        // 2) Also write via navigator.clipboard API (guaranteed OS clipboard
        //    write in Electron regardless of macOS Edit-menu configuration).
        //    Wrap in try/catch because navigator.clipboard may be undefined in
        //    test environments (jsdom) or restricted contexts.
        try {
          void navigator.clipboard?.writeText(text).then(
            () => console.log("[Clipboard] navigator.clipboard.writeText succeeded"),
            (err) => console.warn("[Clipboard] navigator.clipboard.writeText failed:", err),
          );
        } catch {
          // Clipboard API unavailable — e.clipboardData.setData above is sufficient
        }
      }
    };

    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [tableDivRef]);

  return { startTextSelect };
}
