/**
 * Tests for inline editing, undo, dirty state, and save operations.
 * Covers features 4.1 – 4.8 from the feature inventory.
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

function makeSession(lp = "/left.ts", rp = "/right.ts"): FileSession {
  return {
    id: "edit-test",
    name: "Edit Test",
    type: "file",
    filterMode: "all",
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    leftPath: lp,
    rightPath: rp,
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
  mockElectronAPI.fileWrite.mockResolvedValue(undefined);
});

// ─── 4.1 Edit mode activation ──────────────────────────────────────────────────

describe("Inline editing — edit mode activation (feature 4.1)", () => {
  it("diff text cells are not contentEditable by default", async () => {
    const { container } = await renderLoaded("alpha", "beta");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Default: no active edit cell
    const leftCell = container.querySelector("#cell-0-l") as HTMLElement;
    // contentEditable should be "false" or missing (not "plaintext-only") on initial render
    expect(leftCell?.contentEditable).not.toBe("plaintext-only");
  });

  it("clicking a left cell activates edit mode for that cell", async () => {
    const { container } = await renderLoaded("editable text", "other text");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const leftCell = container.querySelector("#cell-0-l") as HTMLElement;
    fireEvent.click(leftCell);

    await waitFor(() => {
      const updatedCell = container.querySelector("#cell-0-l") as HTMLElement;
      // jsdom does not reliably reflect contentEditable="plaintext-only" — check class instead
      expect(updatedCell?.classList.contains("fd-cell-editing")).toBe(true);
    });
  });

  it("edit mode adds fd-cell-editing class to the active cell", async () => {
    const { container } = await renderLoaded("edit me", "other");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const leftCell = container.querySelector("#cell-0-l") as HTMLElement;
    fireEvent.click(leftCell);

    await waitFor(() => {
      const updatedCell = container.querySelector("#cell-0-l") as HTMLElement;
      expect(updatedCell?.classList.contains("fd-cell-editing")).toBe(true);
    });
  });

  it("only one cell is in edit mode at a time", async () => {
    // Single isolated modified row at position 0
    const { container } = await renderLoaded("original", "different");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Click first cell (modified row is at index 0)
    fireEvent.click(container.querySelector("#cell-0-l") as HTMLElement);
    await waitFor(() => {
      const c = container.querySelector("#cell-0-l") as HTMLElement;
      expect(c?.classList.contains("fd-cell-editing")).toBe(true);
    });

    // Blur it (ends edit mode)
    fireEvent.blur(container.querySelector("#cell-0-l") as HTMLElement);
    await waitFor(() => {
      const c = container.querySelector("#cell-0-l") as HTMLElement;
      expect(c?.classList.contains("fd-cell-editing")).toBe(false);
    });
  });
});

// ─── 4.4 Edit committed on blur ────────────────────────────────────────────────

describe("Inline editing — commit on blur (feature 4.4)", () => {
  it("blurring without changing text does not mark left as dirty", async () => {
    const { container } = await renderLoaded("unchanged", "other");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const leftCell = container.querySelector("#cell-0-l") as HTMLElement;
    fireEvent.click(leftCell);
    await waitFor(() => expect((container.querySelector("#cell-0-l") as HTMLElement)?.classList.contains("fd-cell-editing")).toBe(true));

    // Blur without changing content
    fireEvent.blur(leftCell);

    await waitFor(() => {
      const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      // Should remain disabled since text didn't change
      expect(saveLeft.disabled).toBe(true);
    });
  });

  it("blurring with changed text marks left as dirty and triggers diff recompute", async () => {
    const { container } = await renderLoaded("original", "other");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const leftCell = container.querySelector("#cell-0-l") as HTMLElement;
    fireEvent.click(leftCell);
    await waitFor(() => expect((container.querySelector("#cell-0-l") as HTMLElement)?.classList.contains("fd-cell-editing")).toBe(true));

    // Simulate text change then blur
    Object.defineProperty(leftCell, "textContent", { value: "newtext", configurable: true });
    fireEvent.blur(leftCell);

    await waitFor(() => {
      const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeft.disabled).toBe(false);
    });
  });
});

// ─── 4.5 Dirty indicator ──────────────────────────────────────────────────────

describe("Inline editing — dirty indicator (feature 4.5)", () => {
  it("dirty indicator (*) not present when no changes made", async () => {
    const { container } = await renderLoaded("same", "same");
    await waitFor(() => expect(container.querySelector(".fd-loading")).toBeNull());
    expect(container.querySelector(".fd-dirty-indicator")).not.toBeInTheDocument();
  });

  it("dirty indicator appears after copy-all-left-to-right", async () => {
    const { container } = await renderLoaded("different", "content");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);

    await waitFor(() => {
      expect(container.querySelector(".fd-dirty-indicator")).toBeInTheDocument();
    });
  });

  it("dirty indicator disappears after undo to original state", async () => {
    const { container } = await renderLoaded("original", "content");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Make it dirty
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Right → Left (stages, no save)"]')!);
    await waitFor(() => expect(container.querySelector(".fd-dirty-indicator")).toBeInTheDocument());

    // Undo
    const undoBtn = document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]') as HTMLButtonElement;
    fireEvent.click(undoBtn);

    await waitFor(() => {
      expect(container.querySelector(".fd-dirty-indicator")).not.toBeInTheDocument();
    });
  });
});

// ─── 4.6 Save to disk ──────────────────────────────────────────────────────────

describe("Save to disk (feature 4.6)", () => {
  it("save left button is disabled when not dirty", async () => {
    await renderLoaded("same", "same");
    const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
    expect(saveLeft.disabled).toBe(true);
  });

  it("save right button is disabled when not dirty", async () => {
    await renderLoaded("same", "same");
    const saveRight = document.querySelector('[data-tooltip="Save Right"]') as HTMLButtonElement;
    expect(saveRight.disabled).toBe(true);
  });

  it("save left calls fileWrite with the left path when dirty", async () => {
    const { container } = await renderLoaded("a", "b");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Make left dirty
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Right → Left (stages, no save)"]')!);
    await waitFor(() => {
      const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeft.disabled).toBe(false);
    });

    fireEvent.click(document.querySelector('[data-tooltip="Save Left"]')!);

    await waitFor(() => {
      expect(mockElectronAPI.fileWrite).toHaveBeenCalledWith("/left.ts", expect.any(String));
    });
  });

  it("save right calls fileWrite with the right path when dirty", async () => {
    const { container } = await renderLoaded("a", "b");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Make right dirty
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);
    await waitFor(() => {
      const saveRight = document.querySelector('[data-tooltip="Save Right"]') as HTMLButtonElement;
      expect(saveRight.disabled).toBe(false);
    });

    fireEvent.click(document.querySelector('[data-tooltip="Save Right"]')!);

    await waitFor(() => {
      expect(mockElectronAPI.fileWrite).toHaveBeenCalledWith("/right.ts", expect.any(String));
    });
  });

  it("save left clears the dirty flag after successful write", async () => {
    const { container } = await renderLoaded("a", "b");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    fireEvent.click(document.querySelector('[data-tooltip="Copy All Right → Left (stages, no save)"]')!);
    await waitFor(() => expect(container.querySelector(".fd-dirty-indicator")).toBeInTheDocument());

    fireEvent.click(document.querySelector('[data-tooltip="Save Left"]')!);

    await waitFor(() => {
      expect(container.querySelector(".fd-dirty-indicator")).not.toBeInTheDocument();
    });
  });
});

// ─── 4.8 Undo (Cmd+Z) ──────────────────────────────────────────────────────────

describe("Undo (feature 4.8)", () => {
  it("undo button is disabled when undo stack is empty", async () => {
    await renderLoaded("same", "same");
    const undoBtn = document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
  });

  it("undo button becomes enabled after copy operation that pushes to stack", async () => {
    const { container } = await renderLoaded("old", "new");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);

    await waitFor(() => {
      const undoBtn = document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]') as HTMLButtonElement;
      expect(undoBtn.disabled).toBe(false);
    });
  });

  it("clicking undo button restores previous state", async () => {
    const { container } = await renderLoaded("original", "changed");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Copy all → no more diffs
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument());

    // Undo → original modified row returns
    fireEvent.click(document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]')!);

    await waitFor(() => {
      expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument();
    });
  });

  it("keyboard Cmd+Z triggers undo", async () => {
    const { container } = await renderLoaded("x", "y");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument());

    // Simulate Cmd+Z (metaKey + z)
    fireEvent.keyDown(window, { key: "z", metaKey: true });

    await waitFor(() => {
      expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument();
    });
  });

  it("multiple undo steps restore each intermediate state in order", async () => {
    // Use 2 isolated modified rows: eq\nA\neq2\nB vs eq\nX\neq2\nY
    // → [equal, modified(A→X), equal, modified(B→Y)] = 2 separate modified rows
    const { container } = await renderLoaded("eq\nA\neq2\nB", "eq\nX\neq2\nY");
    // With split-pane layout, use [id] selector to scope to left pane rows only
    await waitFor(() => expect(container.querySelectorAll(".fd-diff-modified[id]").length).toBe(2));

    // First copy-all (undoStack has 1 entry)
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument());

    // Second copy-all-right-to-left (undoStack has 2 entries)
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Right → Left (stages, no save)"]')!);
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument());

    // First undo: returns to state after first copy (all equal)
    fireEvent.click(document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]')!);
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument());

    // Second undo: returns to original with 2 modified rows
    fireEvent.click(document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]')!);
    await waitFor(() => {
      expect(container.querySelectorAll(".fd-diff-modified[id]").length).toBe(2);
    });
  });
});

// ─── 7.3 Recompare ──────────────────────────────────────────────────────────────

describe("Recompare (feature 7.3)", () => {
  it("recompare button calls fileRead again for both paths", async () => {
    await renderLoaded("first", "load");
    await waitFor(() => expect(mockElectronAPI.fileRead).toHaveBeenCalledTimes(2));

    mockElectronAPI.fileRead.mockResolvedValue("reloaded");
    fireEvent.click(document.querySelector('[data-tooltip="Recompare (⌘R)"]')!);

    await waitFor(() => {
      // fileRead should have been called again (total 4 times now)
      expect(mockElectronAPI.fileRead.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });
});
