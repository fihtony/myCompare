import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as useDropZoneModule from "../renderer/hooks/useDropZone";
import EmptyState from "../renderer/components/EmptyState";

// Mock the entire module so we can control isDragging
vi.mock("../renderer/hooks/useDropZone", async (importOriginal) => {
  const mod = await importOriginal<typeof useDropZoneModule>();
  return { ...mod, useDraggingState: vi.fn().mockReturnValue(false) };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmptyState", () => {
  it("renders welcome message when not dragging", () => {
    vi.mocked(useDropZoneModule.useDraggingState).mockReturnValue(false);
    render(<EmptyState />);
    expect(screen.getByText(/macompare/i)).toBeInTheDocument();
  });

  it("shows drag overlay when isDragging is true", () => {
    vi.mocked(useDropZoneModule.useDraggingState).mockReturnValue(true);
    render(<EmptyState />);
    // The drag overlay shows this specific text when dragging
    expect(screen.getByText(/Drop files or folders here/i)).toBeInTheDocument();
  });

  it("does not show drag overlay when not dragging", () => {
    vi.mocked(useDropZoneModule.useDraggingState).mockReturnValue(false);
    render(<EmptyState />);
    // The drag overlay text should NOT be present
    expect(screen.queryByText(/Drop files or folders here/i)).toBeNull();
  });
});
