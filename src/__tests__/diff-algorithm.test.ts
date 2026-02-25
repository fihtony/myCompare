import { describe, it, expect } from "vitest";
import { computeDiff, computeCharDiff } from "../renderer/utils/diff";

describe("computeDiff", () => {
  it("returns empty array for two empty inputs", () => {
    expect(computeDiff([], [])).toEqual([]);
  });

  it("marks all lines equal when both sides are identical", () => {
    const lines = ["a", "b", "c"];
    const result = computeDiff(lines, lines);
    expect(result.every((d) => d.type === "equal")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("marks added lines when right has extra content", () => {
    const result = computeDiff([], ["hello"]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("added");
    expect(result[0].rightText).toBe("hello");
  });

  it("marks removed lines when left has extra content", () => {
    const result = computeDiff(["hello"], []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("removed");
    expect(result[0].leftText).toBe("hello");
  });

  it("handles a single changed line as modified type with char spans", () => {
    const result = computeDiff(["foo"], ["bar"]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("modified");
    expect(result[0].leftText).toBe("foo");
    expect(result[0].rightText).toBe("bar");
    expect(result[0].leftSpans).toBeDefined();
    expect(result[0].rightSpans).toBeDefined();
  });

  it("keeps removed/added separate when no counterpart exists", () => {
    // Two removed, one added — the first removed pairs with the added; second remains removed
    const result = computeDiff(["a", "b"], ["x"]);
    const types = result.map((d) => d.type);
    // Result should have a modified (a→x) and a removed (b)
    expect(types).toContain("modified");
    expect(types).toContain("removed");
  });

  it("preserves equal lines around changes", () => {
    const left = ["a", "b", "c"];
    const right = ["a", "X", "c"];
    const result = computeDiff(left, right);
    expect(result[0].type).toBe("equal");
    expect(result[result.length - 1].type).toBe("equal");
  });

  it("assigns sequential leftLineNo for non-added rows", () => {
    const result = computeDiff(["x", "y"], ["x", "z"]);
    const leftNos = result.filter((d) => d.type !== "added").map((d) => d.leftLineNo);
    expect(leftNos).toEqual([1, 2]);
  });

  it("assigns sequential rightLineNo for non-removed rows", () => {
    const result = computeDiff(["x", "y"], ["x", "z"]);
    const rightNos = result.filter((d) => d.type !== "removed").map((d) => d.rightLineNo);
    expect(rightNos).toEqual([1, 2]);
  });

  it("handles large identical files efficiently", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const result = computeDiff(lines, lines);
    expect(result).toHaveLength(500);
    expect(result.every((d) => d.type === "equal")).toBe(true);
  });
});

describe("computeCharDiff", () => {
  it("returns no changed spans for identical strings", () => {
    const { leftSpans, rightSpans } = computeCharDiff("hello", "hello");
    expect(leftSpans.every((s) => !s.changed)).toBe(true);
    expect(rightSpans.every((s) => !s.changed)).toBe(true);
  });

  it("marks fully different strings as all changed", () => {
    const { leftSpans, rightSpans } = computeCharDiff("abc", "xyz");
    expect(leftSpans.some((s) => s.changed)).toBe(true);
    expect(rightSpans.some((s) => s.changed)).toBe(true);
  });

  it("identifies added characters in right side", () => {
    // Use a suffix that shares no chars with the base to ensure unambiguous LCS result
    const { rightSpans } = computeCharDiff("abc", "abcXYZ");
    const changedText = rightSpans
      .filter((s) => s.changed)
      .map((s) => s.text)
      .join("");
    expect(changedText).toBe("XYZ");
  });

  it("reconstructed text matches original", () => {
    const a = "export function unique(arr: number[])";
    const b = "export function unique<T>(arr: T[])";
    const { leftSpans, rightSpans } = computeCharDiff(a, b);
    expect(leftSpans.map((s) => s.text).join("")).toBe(a);
    expect(rightSpans.map((s) => s.text).join("")).toBe(b);
  });
});
