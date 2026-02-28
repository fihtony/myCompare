/**
 * Tests for clipboard copy behavior (feature 6.x).
 *
 * Covers:
 * 6.1/6.2  mousedown sets fd-selecting-left/right class on split-wrapper
 * 6.3      copy event extracts clean text from the selected cells
 * 6.4      paste works natively in contentEditable edit mode
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { mockElectronAPI } from "./setup";
import FileDiffView from "../renderer/components/FileDiffView";
import type { FileSession } from "../shared/types";

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn().mockReturnValue({ value: "code" }),
    getLanguage: vi.fn().mockReturnValue(true),
  },
}));
vi.mock("../renderer/components/HexDiffView", () => ({
  default: () => <div>HexDiffView</div>,
}));

function makeSession(): FileSession {
  return {
    id: "clipboard-test",
    name: "Clipboard Test",
    type: "file",
    filterMode: "all",
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    leftPath: "/left.ts",
    rightPath: "/right.ts",
    viewMode: "text",
  };
}

async function renderLoaded(leftContent: string, rightContent: string) {
  mockElectronAPI.fileRead.mockResolvedValueOnce(leftContent).mockResolvedValueOnce(rightContent);
  const result = render(<FileDiffView session={makeSession()} />);
  await waitFor(() => expect(result.container.querySelector(".fd-loading")).toBeNull());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockElectronAPI.fileDetectBinary.mockResolvedValue(false);
  mockElectronAPI.fileRead.mockResolvedValue("x");
  mockElectronAPI.fileStat.mockResolvedValue({ size: 512, birthtime: 0, mtime: 0, readonly: false, hidden: false });
});

// ─── 6.1 / 6.2 Text cell mousedown events ──────────────────────────────────────

describe("Text selection setup (features 6.1, 6.2)", () => {
  it("left text cells have fd-line-left class", async () => {
    const { container } = await renderLoaded("line1\nline2", "line1\nlineX");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());
  });

  it("right text cells have fd-line-right class", async () => {
    const { container } = await renderLoaded("line1\nline2", "line1\nlineX");
    await waitFor(() => expect(container.querySelector(".fd-line-right")).toBeInTheDocument());
  });

  it("mousedown on left cell adds fd-selecting-left class to table div", async () => {
    const { container } = await renderLoaded("text", "other");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());

    const leftCell = container.querySelector(".fd-line-left") as HTMLElement;
    fireEvent.mouseDown(leftCell);

    await waitFor(() => {
      // In split-pane layout, fd-selecting-* class is on .fd-split-wrapper, not .fd-diff-table
      const table = container.querySelector(".fd-split-wrapper") as HTMLElement;
      expect(table?.classList.contains("fd-selecting-left")).toBe(true);
    });
  });

  it("mousedown on right cell adds fd-selecting-right class to table div", async () => {
    const { container } = await renderLoaded("text", "other");
    await waitFor(() => expect(container.querySelector(".fd-line-right")).toBeInTheDocument());

    const rightCell = container.querySelector(".fd-line-right") as HTMLElement;
    fireEvent.mouseDown(rightCell);

    await waitFor(() => {
      const table = container.querySelector(".fd-split-wrapper") as HTMLElement;
      expect(table?.classList.contains("fd-selecting-right")).toBe(true);
    });
  });

  it("switching from left to right selection replaces fd-selecting-left with fd-selecting-right", async () => {
    const { container } = await renderLoaded("text", "other");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());

    const leftCell = container.querySelector(".fd-line-left") as HTMLElement;
    const rightCell = container.querySelector(".fd-line-right") as HTMLElement;

    fireEvent.mouseDown(leftCell);
    await waitFor(() => {
      const table = container.querySelector(".fd-split-wrapper") as HTMLElement;
      expect(table?.classList.contains("fd-selecting-left")).toBe(true);
    });

    fireEvent.mouseDown(rightCell);
    await waitFor(() => {
      const table = container.querySelector(".fd-split-wrapper") as HTMLElement;
      expect(table?.classList.contains("fd-selecting-right")).toBe(true);
      expect(table?.classList.contains("fd-selecting-left")).toBe(false);
    });
  });
});

// ─── 6.3 Copy to clipboard ─────────────────────────────────────────────────────

/**
 * Helper: simulate a selection spanning the full contents of `el`, then fire a
 * copy event and return the text that would have been written to the clipboard.
 *
 * Works in jsdom because jsdom implements Selection/Range and
 * compareBoundaryPoints, which our handleCopy now uses correctly.
 */
function fireCopyOnElement(el: HTMLElement): string {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);

  let captured = "";
  const setDataSpy = vi.fn((_type: string, data: string) => {
    captured = data;
  });
  const clipboardEvent = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(clipboardEvent, "clipboardData", {
    value: { setData: setDataSpy, getData: vi.fn() },
    configurable: true,
  });
  document.dispatchEvent(clipboardEvent);
  return captured;
}

describe("Clipboard copy mechanism (feature 6.3)", () => {
  it("copy event does nothing (no setData) when no table is focused", async () => {
    const { container } = await renderLoaded("text", "other");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());

    // Ensure no selecting class
    const wrapper = container.querySelector(".fd-split-wrapper") as HTMLElement;
    wrapper.classList.remove("fd-selecting-left", "fd-selecting-right");

    const setDataSpy = vi.fn();
    const clipboardEvent = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(clipboardEvent, "clipboardData", {
      value: { setData: setDataSpy, getData: vi.fn() },
      configurable: true,
    });
    document.dispatchEvent(clipboardEvent);

    expect(setDataSpy).not.toHaveBeenCalled();
  });

  it("copy event does nothing when selection is collapsed (no text selected)", async () => {
    const { container } = await renderLoaded("text", "other");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());

    const wrapper = container.querySelector(".fd-split-wrapper") as HTMLElement;
    wrapper.classList.add("fd-selecting-left");
    window.getSelection()?.removeAllRanges();

    const setDataSpy = vi.fn();
    const clipboardEvent = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(clipboardEvent, "clipboardData", {
      value: { setData: setDataSpy, getData: vi.fn() },
      configurable: true,
    });
    document.dispatchEvent(clipboardEvent);

    expect(setDataSpy).not.toHaveBeenCalled();
  });

  it("copy on a single left cell produces its text content", async () => {
    // Use a modified line so left cell has text "hello"
    const { container } = await renderLoaded("hello", "world");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());

    const leftCell = container.querySelector(".fd-line-left") as HTMLElement;
    expect(leftCell).not.toBeNull();

    const copied = fireCopyOnElement(leftCell);
    expect(copied).toBe("hello");
  });

  it("copy on a single right cell produces its text content", async () => {
    const { container } = await renderLoaded("hello", "world");
    await waitFor(() => expect(container.querySelector(".fd-line-right")).toBeInTheDocument());

    const rightCell = container.querySelector(".fd-line-right") as HTMLElement;
    expect(rightCell).not.toBeNull();

    const copied = fireCopyOnElement(rightCell);
    expect(copied).toBe("world");
  });

  it("copy across multiple left cells joins lines with newline", async () => {
    // Strategy: render a real FileDiffView (to register the copy listener and
    // set up tableDivRef), then append two minimal .fd-line-left cells directly
    // into the component's .fd-split-wrapper so that anchorNode is inside
    // tableDivRef.current and no equal-row cells appear between our two cells.
    const { container } = await renderLoaded("changed", "other");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());

    const splitWrapper = container.querySelector(".fd-split-wrapper") as HTMLElement;
    expect(splitWrapper).not.toBeNull();

    // Inject two adjacent .fd-line-left cells into the wrapper
    const cell1 = document.createElement("div");
    cell1.className = "fd-line-left";
    cell1.textContent = "LineA";
    const cell2 = document.createElement("div");
    cell2.className = "fd-line-left";
    cell2.textContent = "LineB";
    splitWrapper.appendChild(cell1);
    splitWrapper.appendChild(cell2);

    try {
      // Select from start of cell1 to end of cell2
      const range = document.createRange();
      range.setStart(cell1, 0);
      range.setEnd(cell2, cell2.childNodes.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);

      let captured = "";
      const setDataSpy = vi.fn((_t: string, d: string) => {
        captured = d;
      });
      const ev = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(ev, "clipboardData", {
        value: { setData: setDataSpy, getData: vi.fn() },
        configurable: true,
      });
      document.dispatchEvent(ev);

      // Both cells should be captured and joined with a newline
      expect(captured).toBe("LineA\nLineB");
    } finally {
      splitWrapper.removeChild(cell1);
      splitWrapper.removeChild(cell2);
    }
  });

  it("mousedown on left text cell does NOT clear the selection (allows drag-select)", async () => {
    const { container } = await renderLoaded("alpha", "beta");
    await waitFor(() => expect(container.querySelector(".fd-line-left")).toBeInTheDocument());

    // Pre-seed a selection so we can verify it survives mousedown
    const leftCell = container.querySelector(".fd-line-left") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(leftCell);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // mousedown should set the class but NOT wipe the selection
    fireEvent.mouseDown(leftCell);

    // Selection must still be present (not empty)
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });
});

// ─── 6.4 Native paste in edit mode ─────────────────────────────────────────────

describe("Native paste in edit mode (feature 6.4)", () => {
  it("paste event is not intercepted when no active edit cell is focused", async () => {
    const { container } = await renderLoaded("a", "b");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // No cell is in edit mode — paste should not throw or crash
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { getData: vi.fn().mockReturnValue("pasted text") },
      configurable: true,
    });
    expect(() => document.dispatchEvent(pasteEvent)).not.toThrow();
  });

  it("clicking a modified left cell activates contentEditable for native paste", async () => {
    const { container } = await renderLoaded("old", "new");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const leftCell = container.querySelector(".fd-line-left.fd-line-modified-left") as HTMLElement;
    expect(leftCell).not.toBeNull();
    // Before click — not contentEditable
    expect(leftCell.getAttribute("contenteditable")).toBeNull();

    // Click activates edit mode
    fireEvent.click(leftCell);
    await waitFor(() => {
      const editCell = container.querySelector("[contenteditable='plaintext-only']") as HTMLElement | null;
      expect(editCell).not.toBeNull();
    });
  });
});

// ─── 6.5 Multi-line paste — TODO (to be implemented in future) ────

describe("Multi-line paste (feature 6.5 — to be implemented)", () => {
  it.todo("pasting 3 lines of text into left cell adds 3 lines to the diff on the left side");
  it.todo("pasting adds undo step so Cmd+Z reverts the paste");
  it.todo("pasting marks the edited side as dirty");
});
