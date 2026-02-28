/**
 * Tests for all line/block/bulk copy operations in FileDiffView.
 * Covers features 5.1 – 5.6 from the feature inventory.
 *
 * Key: computeDiff pairs *adjacent* removed+added into modified. For ["A","B"] vs ["X","Y"]
 * the result is [removed(A), modified(B→X), added(Y)], NOT two modified rows.
 * To test block groups (2+ consecutive non-equal rows), use data like
 * "a\nA\nC\nd" vs "a\nB\nD\nd" → [equal, removed, modified, added, equal].
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { mockElectronAPI } from "./setup";
import FileDiffView from "../renderer/components/FileDiffView";
import type { FileSession } from "../shared/types";

/** All non-equal diff rows in the rendered container */
function allDiffRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".fd-diff-modified, .fd-diff-removed, .fd-diff-added")) as HTMLElement[];
}

/** Left-side line-number element of the first non-equal diff row */
function firstDiffLineNo(container: HTMLElement): HTMLElement | null {
  const row = container.querySelector(".fd-diff-modified, .fd-diff-removed, .fd-diff-added") as HTMLElement | null;
  return (row?.querySelector(".fd-line-no") as HTMLElement | null) ?? null;
}

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn().mockReturnValue({ value: "code" }),
    getLanguage: vi.fn().mockReturnValue(true),
  },
}));
vi.mock("../renderer/components/HexDiffView", () => ({
  default: () => <div data-testid="hex-diff-view">HexDiffView</div>,
}));

function makeSession(lp = "/left.ts", rp = "/right.ts"): FileSession {
  return {
    id: "copy-test",
    name: "Copy Test",
    type: "file",
    filterMode: "all",
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    leftPath: lp,
    rightPath: rp,
    viewMode: "text",
  };
}

/**
 * Render the component with specific file contents and wait until the diff
 * table is fully populated (loading spinner gone).
 */
async function renderLoaded(leftContent: string, rightContent: string) {
  mockElectronAPI.fileRead.mockResolvedValueOnce(leftContent).mockResolvedValueOnce(rightContent);
  const container = render(<FileDiffView session={makeSession()} />);
  await waitFor(() => expect(container.container.querySelector(".fd-loading")).toBeNull());
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockElectronAPI.fileDetectBinary.mockResolvedValue(false);
  mockElectronAPI.fileRead.mockResolvedValue("x");
  mockElectronAPI.fileStat.mockResolvedValue({
    size: 512,
    birthtime: 0,
    mtime: 0,
    readonly: false,
    hidden: false,
  });
});

// ─── 5.3 Copy All ──────────────────────────────────────────────────────────────

describe("Copy All Left → Right / Right → Left (feature 5.3)", () => {
  it("copies all left content to right: diffs disappear, right gets dirty", async () => {
    // "foo" vs "bar" → 1 modified row
    const { container } = await renderLoaded("foo", "bar");
    await waitFor(() => expect(allDiffRows(container).length).toBeGreaterThan(0));

    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);

    await waitFor(() => {
      // All rows now equal
      expect(allDiffRows(container).length).toBe(0);
      // Right save button becomes enabled
      const saveRight = document.querySelector('[data-tooltip="Save Right"]') as HTMLButtonElement;
      expect(saveRight.disabled).toBe(false);
    });
  });

  it("copies all right content to left: left becomes dirty", async () => {
    const { container } = await renderLoaded("old", "new");
    await waitFor(() => expect(allDiffRows(container).length).toBeGreaterThan(0));

    fireEvent.click(document.querySelector('[data-tooltip="Copy All Right → Left (stages, no save)"]')!);

    await waitFor(() => {
      expect(allDiffRows(container).length).toBe(0);
      const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeft.disabled).toBe(false);
    });
  });

  it("copy all sets dirty indicator visible", async () => {
    const { container } = await renderLoaded("foo", "bar");
    await waitFor(() => expect(allDiffRows(container).length).toBeGreaterThan(0));

    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]')!);

    await waitFor(() => {
      expect(container.querySelector(".fd-dirty-indicator")).toBeInTheDocument();
    });
  });
});

// ─── 5.1 Single-line copy ──────────────────────────────────────────────────────

describe("Copy single line to other side (feature 5.1)", () => {
  it("copy-to-right button removes the diff row (makes it equal)", async () => {
    const { container } = await renderLoaded("a\nchanged\nc", "a\noriginal\nc");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const copyRight = container.querySelector(".fd-line-copy-right") as HTMLButtonElement;
    expect(copyRight).toBeInTheDocument();
    fireEvent.click(copyRight);

    await waitFor(() => {
      // Modified row gone, right is dirty
      expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument();
      const saveRight = document.querySelector('[data-tooltip="Save Right"]') as HTMLButtonElement;
      expect(saveRight.disabled).toBe(false);
    });
  });

  it("copy-to-left button makes left dirty and removes diff", async () => {
    const { container } = await renderLoaded("leftVal", "rightVal");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const copyLeft = container.querySelector(".fd-line-copy-left") as HTMLButtonElement;
    expect(copyLeft).toBeInTheDocument();
    fireEvent.click(copyLeft);

    await waitFor(() => {
      expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument();
      const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeft.disabled).toBe(false);
    });
  });

  it("copy-to-right button not shown for equal rows", async () => {
    const { container } = await renderLoaded("same", "same");
    await waitFor(() => expect(container.querySelector(".fd-diff-equal")).toBeInTheDocument());
    expect(container.querySelector(".fd-line-copy-right")).not.toBeInTheDocument();
  });

  it("copy line clears row selection", async () => {
    const { container } = await renderLoaded("before", "after");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Select the row first via line-no click
    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);
    await waitFor(() => expect(container.querySelector(".fd-row-selected")).toBeInTheDocument());

    // Now copy line to right
    const copyRight = container.querySelector(".fd-line-copy-right") as HTMLButtonElement;
    fireEvent.click(copyRight);

    await waitFor(() => {
      expect(container.querySelector(".fd-row-selected")).not.toBeInTheDocument();
    });
  });
});

// ─── 5.2 Block (group) copy ────────────────────────────────────────────────────

describe("Copy block/group to other side (feature 5.2)", () => {
  it("shows block copy buttons for groups of 2+ consecutive diff lines", async () => {
    // "a\nA\nC\nd" vs "a\nB\nD\nd" → [equal(a), removed(A), modified(C→B), added(D), equal(d)]
    // 3 consecutive non-equal rows form one block group
    const { container } = await renderLoaded("a\nA\nC\nd", "a\nB\nD\nd");
    // Wait for diff rows to be present
    await waitFor(() => expect(allDiffRows(container).length).toBeGreaterThan(0));
    // fd-group-first class is on the first row of a multi-row group
    await waitFor(() => {
      expect(container.querySelector(".fd-group-first")).toBeInTheDocument();
    });
    // Block copy buttons: title is dynamic "Copy N lines to right/left"
    await waitFor(() => {
      expect(container.querySelector('[title*="lines to right"]')).toBeInTheDocument();
    });
  });

  it("block copy to right removes all diff rows in the group", async () => {
    const { container } = await renderLoaded("a\nA\nC\nd", "a\nB\nD\nd");
    await waitFor(() => expect(allDiffRows(container).length).toBeGreaterThan(0));
    await waitFor(() => {
      expect(container.querySelector('[title*="lines to right"]')).toBeInTheDocument();
    });

    fireEvent.click(container.querySelector('[title*="lines to right"]')!);

    await waitFor(() => {
      expect(allDiffRows(container).length).toBe(0);
    });
  });

  it("block copy to left removes all diff rows in the group and marks left dirty", async () => {
    const { container } = await renderLoaded("a\nA\nC\nd", "a\nB\nD\nd");
    await waitFor(() => expect(allDiffRows(container).length).toBeGreaterThan(0));
    await waitFor(() => {
      expect(container.querySelector('[title*="lines to left"]')).toBeInTheDocument();
    });

    fireEvent.click(container.querySelector('[title*="lines to left"]')!);

    await waitFor(() => {
      expect(allDiffRows(container).length).toBe(0);
      const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeft.disabled).toBe(false);
    });
  });

  it("single diff line shows single arrow (not block arrow)", async () => {
    // Single isolated modified row surrounded by equal rows → no block group (group size 1)
    const { container } = await renderLoaded("equal\nchanged\nequal", "equal\ndifferent\nequal");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());
    // No block copy buttons (isInBlock = false for single-row groups)
    expect(container.querySelector('[title*="lines to right"]')).not.toBeInTheDocument();
    expect(container.querySelector('[title*="lines to left"]')).not.toBeInTheDocument();
  });
});

// ─── 5.4 Row selection via line-no click ──────────────────────────────────────

describe("Row selection (feature 5.4)", () => {
  it("clicking line number on diff row selects it", async () => {
    const { container } = await renderLoaded("a", "b");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);

    await waitFor(() => {
      expect(container.querySelector(".fd-row-selected")).toBeInTheDocument();
    });
  });

  it("clicking same line number twice deselects it", async () => {
    const { container } = await renderLoaded("a", "b");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);
    await waitFor(() => expect(container.querySelector(".fd-row-selected")).toBeInTheDocument());

    fireEvent.click(lineNo);
    await waitFor(() => {
      expect(container.querySelector(".fd-row-selected")).not.toBeInTheDocument();
    });
  });

  it("Shift+click extends selection to a range", async () => {
    // Use isolated modified rows: eq\nA\neq2\nB\neq3\nC vs eq\nX\neq2\nY\neq3\nZ
    // → [equal, modified, equal, modified, equal, modified] = 3 separate modified rows
    const { container } = await renderLoaded("eq\nA\neq2\nB\neq3\nC", "eq\nX\neq2\nY\neq3\nZ");
    // With split-pane layout, use [id] selector to scope to left pane rows only
    await waitFor(() => expect(container.querySelectorAll(".fd-diff-modified[id]").length).toBe(3));

    const modifiedRows = Array.from(container.querySelectorAll(".fd-diff-modified[id]")) as HTMLElement[];
    // Click first modified row's line-no
    fireEvent.click(modifiedRows[0].querySelector(".fd-line-no")!);
    await waitFor(() => expect(container.querySelector(".fd-row-selected")).toBeInTheDocument());

    // Shift+click last modified row's line-no
    fireEvent.click(modifiedRows[2].querySelector(".fd-line-no")!, { shiftKey: true });
    await waitFor(() => {
      // Only left-pane rows (those with id) carry fd-row-selected
      expect(container.querySelectorAll(".fd-row-selected[id]").length).toBe(3);
    });
  });

  it("equal rows cannot be selected via line-no click", async () => {
    const { container } = await renderLoaded("same\nchanged", "same\ndifferent");
    await waitFor(() => expect(container.querySelector(".fd-diff-equal")).toBeInTheDocument());

    const equalLineNo = container.querySelector(".fd-diff-equal .fd-line-no") as HTMLElement;
    fireEvent.click(equalLineNo);

    await waitFor(() => {
      // No selected row should appear
      expect(container.querySelector(".fd-row-selected")).not.toBeInTheDocument();
    });
  });
});

// ─── 5.5 Copy selected rows ────────────────────────────────────────────────────

describe("Copy selected rows (feature 5.5)", () => {
  it("copy-selected-to-right button copies selected rows and clears selection", async () => {
    const { container } = await renderLoaded("leftA\nequal", "rightA\nequal");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Select the modified row
    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);
    await waitFor(() => expect(container.querySelector(".fd-sel-count")).toBeInTheDocument());

    // Copy selected to right
    fireEvent.click(document.querySelector('[data-tooltip="Copy selected lines → Right"]')!);

    await waitFor(() => {
      expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument();
      expect(container.querySelector(".fd-row-selected")).not.toBeInTheDocument();
    });
  });

  it("copy-selected-to-left button copies selected rows and marks left dirty", async () => {
    const { container } = await renderLoaded("leftB\nequal", "rightB\nequal");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);
    await waitFor(() => expect(container.querySelector(".fd-sel-count")).toBeInTheDocument());

    fireEvent.click(document.querySelector('[data-tooltip="Copy selected lines ← Left"]')!);

    await waitFor(() => {
      expect(container.querySelector(".fd-diff-modified")).not.toBeInTheDocument();
      const saveLeft = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeft.disabled).toBe(false);
    });
  });
});

// ─── 5.6 Clear selection ───────────────────────────────────────────────────────

describe("Clear selection (feature 5.6)", () => {
  it("clear-selection (✕) button removes all selected rows", async () => {
    // Single isolated diff so we can reliably select exactly 1 row
    const { container } = await renderLoaded("same\nX\nsame2", "same\nA\nsame2");
    await waitFor(() => expect(allDiffRows(container).length).toBeGreaterThan(0));

    // Select the diff row via its line-no
    const lineNo = firstDiffLineNo(container)!;
    fireEvent.click(lineNo);
    await waitFor(() => expect(container.querySelector(".fd-sel-count")).toBeInTheDocument());

    // Clear
    fireEvent.click(document.querySelector('[data-tooltip="Clear selection"]')!);

    await waitFor(() => {
      expect(container.querySelector(".fd-row-selected")).not.toBeInTheDocument();
      expect(container.querySelector(".fd-sel-count")).not.toBeInTheDocument();
    });
  });
});
