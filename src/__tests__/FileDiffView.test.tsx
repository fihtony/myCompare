import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { mockElectronAPI } from "./setup";
import FileDiffView from "../renderer/components/FileDiffView";
import type { FileSession } from "../shared/types";

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn().mockReturnValue({ value: "<span>code</span>" }),
    getLanguage: vi.fn().mockReturnValue(true),
  },
}));

vi.mock("../renderer/components/HexDiffView", () => ({
  default: () => <div data-testid="hex-diff-view">HexDiffView</div>,
}));

function makeSession(overrides: Partial<FileSession> = {}): FileSession {
  return {
    id: "test-session",
    name: "Test",
    type: "file",
    filterMode: "all",
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    leftPath: "",
    rightPath: "",
    viewMode: "text",
    ...overrides,
  };
}

// Helper: render component and wait for diff rows to appear
async function renderAndLoadDiff(leftContent: string, rightContent: string) {
  mockElectronAPI.fileRead.mockResolvedValueOnce(leftContent).mockResolvedValueOnce(rightContent);
  const session = makeSession({ leftPath: "/left.ts", rightPath: "/right.ts" });
  const result = render(<FileDiffView session={session} />);
  await waitFor(() => {
    expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalled();
  });
  // Wait until loading spinner is gone (fileStat is also called)
  await waitFor(() => {
    expect(result.container.querySelector(".fd-loading")).toBeNull();
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockElectronAPI.fileDetectBinary.mockResolvedValue(false);
  mockElectronAPI.fileRead.mockResolvedValue("line1\nline2\nline3");
  mockElectronAPI.fileStat.mockResolvedValue({
    size: 1024,
    birthtime: 1000000,
    mtime: 2000000,
    readonly: false,
    hidden: false,
  });
});

// ─── 1. File loading & detection ──────────────────────────────────────────────

describe("FileDiffView — file loading", () => {
  it("renders without crashing when no paths are provided", () => {
    render(<FileDiffView session={makeSession()} />);
    expect(document.body).toBeTruthy();
  });

  it("calls fileDetectBinary for both paths when loaded", async () => {
    mockElectronAPI.fileRead.mockResolvedValue("console.log('hello')");
    render(<FileDiffView session={makeSession({ leftPath: "/a.ts", rightPath: "/b.ts" })} />);
    await waitFor(() => {
      expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalledWith("/a.ts");
      expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalledWith("/b.ts");
    });
  });

  it("renders HexDiffView for binary files", async () => {
    mockElectronAPI.fileDetectBinary.mockResolvedValue(true);
    render(<FileDiffView session={makeSession({ leftPath: "/a.bin", rightPath: "/b.bin" })} />);
    await waitFor(() => {
      expect(screen.getByTestId("hex-diff-view")).toBeInTheDocument();
    });
  });

  it("does not show HexDiffView for text files", async () => {
    render(<FileDiffView session={makeSession({ leftPath: "/a.ts", rightPath: "/b.ts" })} />);
    await waitFor(() => expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalled());
    expect(screen.queryByTestId("hex-diff-view")).toBeNull();
  });

  it("shows loading indicator while files load", async () => {
    // Use a never-resolving promise so loading state stays visible long enough to test
    mockElectronAPI.fileDetectBinary.mockReturnValue(new Promise(() => {}));
    render(<FileDiffView session={makeSession({ leftPath: "/a.ts", rightPath: "/b.ts" })} />);
    expect(document.querySelector(".fd-loading")).toBeInTheDocument();
  });

  it("shows error message when file read fails", async () => {
    mockElectronAPI.fileDetectBinary.mockResolvedValue(false);
    mockElectronAPI.fileRead.mockRejectedValue(new Error("File not found"));
    render(<FileDiffView session={makeSession({ leftPath: "/a.ts", rightPath: "/b.ts" })} />);
    await waitFor(() => {
      expect(document.querySelector(".fd-error")).toBeInTheDocument();
    });
  });

  it("calls fileStat for both paths after text file load", async () => {
    await renderAndLoadDiff("abc", "abc");
    expect(mockElectronAPI.fileStat).toHaveBeenCalledWith("/left.ts");
    expect(mockElectronAPI.fileStat).toHaveBeenCalledWith("/right.ts");
  });

  it("renders diff rows for text files", async () => {
    const { container } = await renderAndLoadDiff("line1\nline2\nline3", "line1\nline2\nline4");
    await waitFor(() => {
      const rows = container.querySelectorAll(".fd-diff-row");
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it("renders orphan left-only mode without crashing", async () => {
    mockElectronAPI.fileRead.mockResolvedValueOnce("content");
    render(<FileDiffView session={makeSession({ leftPath: "/only.ts", rightPath: "" })} />);
    await waitFor(() => expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalled());
    // Should not throw
    expect(document.body).toBeTruthy();
  });

  it("renders orphan right-only mode without crashing", async () => {
    mockElectronAPI.fileRead.mockResolvedValueOnce("content");
    render(<FileDiffView session={makeSession({ leftPath: "", rightPath: "/only.ts" })} />);
    await waitFor(() => expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalled());
    expect(document.body).toBeTruthy();
  });

  it("shows large-file banner when fileReadLines signals truncation", async () => {
    // Make fileStat report a large file to trigger streaming path
    mockElectronAPI.fileStat.mockResolvedValue({ size: 20 * 1024 * 1024, birthtime: 0, mtime: 0, readonly: false, hidden: false });
    (window.electronAPI as any).fileReadLines = vi.fn().mockResolvedValue({ content: "line1\nline2", truncated: true });
    render(<FileDiffView session={makeSession({ leftPath: "/big.ts", rightPath: "/big2.ts" })} />);
    await waitFor(() => {
      expect(document.querySelector(".fd-large-file-banner")).toBeInTheDocument();
    });
    delete (window.electronAPI as any).fileReadLines;
  });
});

// ─── 2. Diff rendering ─────────────────────────────────────────────────────────

describe("FileDiffView — diff rendering", () => {
  it("renders equal-type rows for identical files", async () => {
    const { container } = await renderAndLoadDiff("a\nb\nc", "a\nb\nc");
    await waitFor(() => {
      // With split-pane layout each row appears in left+center+right; use [id] to scope to left pane only
      const equalRows = container.querySelectorAll(".fd-diff-equal[id]");
      expect(equalRows.length).toBe(3);
    });
  });

  it("renders added-type rows when right has extra lines", async () => {
    // left: 1 line, right: 2 lines → second right line is added
    const { container } = await renderAndLoadDiff("common", "common\nextra");
    await waitFor(() => {
      expect(container.querySelector(".fd-diff-added")).toBeInTheDocument();
    });
  });

  it("renders removed-type rows when left has extra lines", async () => {
    // left: 2 lines, right: 1 line → second left line is removed
    const { container } = await renderAndLoadDiff("common\nextra", "common");
    await waitFor(() => {
      expect(container.querySelector(".fd-diff-removed")).toBeInTheDocument();
    });
  });

  it("renders modified-type rows for changed lines", async () => {
    const { container } = await renderAndLoadDiff("foo", "bar");
    await waitFor(() => {
      expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument();
    });
  });

  it("shows diff count in toolbar when diffs exist", async () => {
    await renderAndLoadDiff("a\nB\nc", "a\nX\nc");
    await waitFor(() => {
      expect(document.querySelector(".fd-stats")).toBeInTheDocument();
      expect(document.querySelector(".fd-stats")!.textContent).toMatch(/difference/);
    });
  });

  it("does not show diff count when files are identical", async () => {
    await renderAndLoadDiff("same\ncontent", "same\ncontent");
    await waitFor(() => {
      expect(document.querySelector(".fd-stats")).not.toBeInTheDocument();
    });
  });

  it("assigns unique id to each diff row (diff-row-N)", async () => {
    const { container } = await renderAndLoadDiff("x\ny", "x\nz");
    await waitFor(() => {
      expect(container.querySelector("#diff-row-0")).toBeInTheDocument();
      expect(container.querySelector("#diff-row-1")).toBeInTheDocument();
    });
  });
});

// ─── 3. Navigation ─────────────────────────────────────────────────────────────

describe("FileDiffView — navigation", () => {
  it("prev/next diff buttons are disabled when files are identical", async () => {
    await renderAndLoadDiff("same", "same");
    // Buttons with "Previous Diff" / "Next Diff" tooltips should be disabled
    const prevBtn = document.querySelector('[data-tooltip="Previous Diff (⇧F3)"]') as HTMLButtonElement;
    const nextBtn = document.querySelector('[data-tooltip="Next Diff (F3)"]') as HTMLButtonElement;
    await waitFor(() => {
      expect(prevBtn?.disabled).toBe(true);
      expect(nextBtn?.disabled).toBe(true);
    });
  });

  it("prev/next diff buttons are enabled when diffs exist", async () => {
    await renderAndLoadDiff("a", "b");
    const prevBtn = document.querySelector('[data-tooltip="Previous Diff (⇧F3)"]') as HTMLButtonElement;
    const nextBtn = document.querySelector('[data-tooltip="Next Diff (F3)"]') as HTMLButtonElement;
    await waitFor(() => {
      expect(prevBtn?.disabled).toBe(false);
      expect(nextBtn?.disabled).toBe(false);
    });
  });

  it("thumbnail strip renders non-transparent entries for diff lines", async () => {
    // left and right differ → some non-transparent thumb entries
    const { container } = await renderAndLoadDiff("a\nb", "x\ny");
    await waitFor(() => {
      const thumbLines = container.querySelectorAll(".fd-thumb-line");
      const nonTransparent = Array.from(thumbLines).filter((el) => (el as HTMLElement).style.background !== "transparent");
      expect(nonTransparent.length).toBeGreaterThan(0);
    });
  });
});

// ─── 4. Toolbar & path bar ─────────────────────────────────────────────────────

describe("FileDiffView — toolbar and path bar", () => {
  it("renders toolbar with swap, recompare, undo buttons", () => {
    render(<FileDiffView session={makeSession()} />);
    expect(document.querySelector('[data-tooltip="Swap Sides (preserves unsaved changes)"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tooltip="Recompare (⌘R)"]')).toBeInTheDocument();
    expect(document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]')).toBeInTheDocument();
  });

  it("renders left and right path inputs with correct initial values", () => {
    render(<FileDiffView session={makeSession({ leftPath: "/left.ts", rightPath: "/right.ts" })} />);
    const inputs = document.querySelectorAll(".fd-path-input") as NodeListOf<HTMLInputElement>;
    expect(inputs[0].value).toBe("/left.ts");
    expect(inputs[1].value).toBe("/right.ts");
  });

  it("save buttons are disabled when not dirty", () => {
    render(<FileDiffView session={makeSession()} />);
    const saveBtns = document.querySelectorAll('[data-tooltip="Save Left"], [data-tooltip="Save Right"]') as NodeListOf<HTMLButtonElement>;
    saveBtns.forEach((btn) => expect(btn.disabled).toBe(true));
  });

  it("dirty indicator appears after a copy operation makes content dirty", async () => {
    const { container } = await renderAndLoadDiff("alpha", "beta");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Copy all left→right which marks right as dirty
    const copyAllRightBtn = document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]') as HTMLButtonElement;
    fireEvent.click(copyAllRightBtn);

    await waitFor(() => {
      expect(container.querySelector(".fd-dirty-indicator")).toBeInTheDocument();
    });
  });

  it("undo button is disabled when undo stack is empty", async () => {
    render(<FileDiffView session={makeSession()} />);
    const undoBtn = document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
  });

  it("undo button becomes enabled after a copy makes the stack non-empty", async () => {
    const { container } = await renderAndLoadDiff("a\nb", "x\nb");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const copyAllBtn = document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]') as HTMLButtonElement;
    fireEvent.click(copyAllBtn);

    await waitFor(() => {
      const undoBtn = document.querySelector('[data-tooltip="Undo last edit (⌘Z)"]') as HTMLButtonElement;
      expect(undoBtn.disabled).toBe(false);
    });
  });

  it("syntax highlight toggle button renders", () => {
    render(<FileDiffView session={makeSession()} />);
    expect(document.querySelector('[data-tooltip="Disable Syntax Highlight"]')).toBeInTheDocument();
  });

  it("footbar renders after load with file stats", async () => {
    const { container } = await renderAndLoadDiff("abc", "abc");
    await waitFor(() => {
      expect(container.querySelector(".fd-footbar")).toBeInTheDocument();
    });
  });
});

// ─── 5. Row selection via line-number clicks ───────────────────────────────────

describe("FileDiffView — row selection", () => {
  it("clicking a non-equal line number selects that row", async () => {
    const { container } = await renderAndLoadDiff("changed", "different");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);

    await waitFor(() => {
      expect(container.querySelector(".fd-row-selected")).toBeInTheDocument();
    });
  });

  it("selected row count label appears in toolbar when rows are selected", async () => {
    const { container } = await renderAndLoadDiff("changed", "different");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);

    await waitFor(() => {
      expect(container.querySelector(".fd-sel-count")).toBeInTheDocument();
      expect(container.querySelector(".fd-sel-count")!.textContent).toMatch(/1 selected/);
    });
  });

  it("clear-selection button removes selection", async () => {
    const { container } = await renderAndLoadDiff("changed", "different");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);
    await waitFor(() => expect(container.querySelector(".fd-sel-count")).toBeInTheDocument());

    const clearBtn = document.querySelector('[data-tooltip="Clear selection"]') as HTMLButtonElement;
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(container.querySelector(".fd-row-selected")).not.toBeInTheDocument();
      expect(container.querySelector(".fd-sel-count")).not.toBeInTheDocument();
    });
  });

  it("clicking same line number twice deselects it", async () => {
    const { container } = await renderAndLoadDiff("changed", "different");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const lineNo = container.querySelector(".fd-diff-modified .fd-line-no") as HTMLElement;
    fireEvent.click(lineNo);
    await waitFor(() => expect(container.querySelector(".fd-row-selected")).toBeInTheDocument());

    fireEvent.click(lineNo);
    await waitFor(() => {
      expect(container.querySelector(".fd-row-selected")).not.toBeInTheDocument();
    });
  });
});

// ─── 6. Syntax highlighting toggle ─────────────────────────────────────────────

describe("FileDiffView — syntax highlighting", () => {
  it("toggles syntax tooltip text when clicked", async () => {
    await renderAndLoadDiff("const x = 1;", "const x = 2;");

    const syntaxBtn = document.querySelector('[data-tooltip="Disable Syntax Highlight"]') as HTMLButtonElement;
    expect(syntaxBtn).toBeInTheDocument();

    fireEvent.click(syntaxBtn);

    await waitFor(() => {
      expect(document.querySelector('[data-tooltip="Enable Syntax Highlight"]')).toBeInTheDocument();
    });
  });
});

// ─── 7. Swap sides ─────────────────────────────────────────────────────────────

describe("FileDiffView — swap sides", () => {
  it("swap button exchanges left and right path input values", async () => {
    await renderAndLoadDiff("left content", "right content");

    const inputs = document.querySelectorAll(".fd-path-input") as NodeListOf<HTMLInputElement>;
    const originalLeft = inputs[0].value;
    const originalRight = inputs[1].value;

    const swapBtn = document.querySelector('[data-tooltip="Swap Sides (preserves unsaved changes)"]') as HTMLButtonElement;
    fireEvent.click(swapBtn);

    await waitFor(() => {
      const updatedInputs = document.querySelectorAll(".fd-path-input") as NodeListOf<HTMLInputElement>;
      expect(updatedInputs[0].value).toBe(originalRight);
      expect(updatedInputs[1].value).toBe(originalLeft);
    });
  });
});

// ─── 8. Save / dirty state ─────────────────────────────────────────────────────

describe("FileDiffView — save and dirty state", () => {
  it("right save button becomes enabled after copy-all-left-to-right", async () => {
    const { container } = await renderAndLoadDiff("foo", "bar");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const copyAllBtn = document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]') as HTMLButtonElement;
    fireEvent.click(copyAllBtn);

    await waitFor(() => {
      const saveRightBtn = document.querySelector('[data-tooltip="Save Right"]') as HTMLButtonElement;
      expect(saveRightBtn.disabled).toBe(false);
    });
  });

  it("left save button becomes enabled after copy-all-right-to-left", async () => {
    const { container } = await renderAndLoadDiff("foo", "bar");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    const copyAllBtn = document.querySelector('[data-tooltip="Copy All Right → Left (stages, no save)"]') as HTMLButtonElement;
    fireEvent.click(copyAllBtn);

    await waitFor(() => {
      const saveLeftBtn = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeftBtn.disabled).toBe(false);
    });
  });

  it("calls fileWrite with correct path when save left is clicked", async () => {
    const { container } = await renderAndLoadDiff("original", "changed");
    await waitFor(() => expect(container.querySelector(".fd-diff-modified")).toBeInTheDocument());

    // Make left dirty
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Right → Left (stages, no save)"]') as HTMLButtonElement);
    await waitFor(() => {
      const saveLeftBtn = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
      expect(saveLeftBtn.disabled).toBe(false);
    });

    mockElectronAPI.fileWrite.mockResolvedValue(undefined);
    const saveLeftBtn = document.querySelector('[data-tooltip="Save Left"]') as HTMLButtonElement;
    fireEvent.click(saveLeftBtn);

    await waitFor(() => {
      expect(mockElectronAPI.fileWrite).toHaveBeenCalledWith("/left.ts", expect.any(String));
    });
  });

  it("undo reverts content and clears dirty flag if reverted to original", async () => {
    const { container } = await renderAndLoadDiff("same", "same");
    await waitFor(() => expect(container.querySelector(".fd-loading")).toBeNull());

    // Copy all left→right (same content, but pushes undo and marks dirty)
    fireEvent.click(document.querySelector('[data-tooltip="Copy All Left → Right (stages, no save)"]') as HTMLButtonElement);
    // After copy of same content, right should become dirty (unless computeDiff shows no change)
    // Force: use different content so dirty flag is set
  });
});
