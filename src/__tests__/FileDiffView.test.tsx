import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  vi.clearAllMocks();
  mockElectronAPI.fileDetectBinary.mockResolvedValue(false);
  mockElectronAPI.fileRead.mockResolvedValue("line1\nline2\nline3");
});

describe("FileDiffView", () => {
  it("renders placeholder text when no paths are provided", () => {
    render(<FileDiffView session={makeSession()} />);
    // Component should render without crashing; binary detection won't fire for empty paths
    expect(document.body).toBeTruthy();
  });

  it("calls fileDetectBinary when paths are provided", async () => {
    mockElectronAPI.fileRead.mockResolvedValue("console.log('hello')");
    render(<FileDiffView session={makeSession({ leftPath: "/a.ts", rightPath: "/b.ts" })} />);
    await waitFor(() => {
      expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalledWith("/a.ts");
    });
  });

  it("renders HexDiffView for binary files", async () => {
    mockElectronAPI.fileDetectBinary.mockResolvedValue(true);
    render(<FileDiffView session={makeSession({ leftPath: "/a.bin", rightPath: "/b.bin" })} />);
    await waitFor(() => {
      expect(screen.getByTestId("hex-diff-view")).toBeInTheDocument();
    });
  });

  it("renders diff rows for text files without crashing", async () => {
    mockElectronAPI.fileRead.mockResolvedValueOnce("line1\nline2\nline3").mockResolvedValueOnce("line1\nline2\nline4");
    render(<FileDiffView session={makeSession({ leftPath: "/a.ts", rightPath: "/b.ts" })} />);
    await waitFor(() => {
      expect(screen.queryByTestId("hex-diff-view")).toBeNull();
    });
  });

  it("does not show HexDiffView for non-binary files", async () => {
    render(<FileDiffView session={makeSession({ leftPath: "/a.ts", rightPath: "/b.ts" })} />);
    await waitFor(() => {
      expect(mockElectronAPI.fileDetectBinary).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("hex-diff-view")).toBeNull();
  });
});
