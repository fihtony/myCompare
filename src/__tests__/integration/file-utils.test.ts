// @vitest-environment node
/**
 * Integration test: file utilities
 * Uses real files in data/.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { readFileAsText, detectFileBinary, readFileHex, getPathStat, isBinaryBuffer } from "../../main/core/file-utils";
import { computeDiff } from "../../renderer/utils/diff";

const DATA = path.resolve(__dirname, "../../../data");

describe("readFileAsText", () => {
  it("reads a text file correctly", async () => {
    const content = await readFileAsText(path.join(DATA, "file-a.ts"));
    expect(content).toContain("class Stack");
    expect(content).toContain("push");
  });

  it("throws on missing file", async () => {
    await expect(readFileAsText(path.join(DATA, "nonexistent.ts"))).rejects.toThrow();
  });
});

describe("detectFileBinary", () => {
  it("returns false for text files", async () => {
    expect(await detectFileBinary(path.join(DATA, "file-a.ts"))).toBe(false);
    expect(await detectFileBinary(path.join(DATA, "left/config.json"))).toBe(false);
  });

  it("returns true for binary files", async () => {
    expect(await detectFileBinary(path.join(DATA, "binary-a.bin"))).toBe(true);
    expect(await detectFileBinary(path.join(DATA, "binary-b.bin"))).toBe(true);
  });

  it("returns false for missing files (no throw)", async () => {
    expect(await detectFileBinary(path.join(DATA, "missing.bin"))).toBe(false);
  });
});

describe("isBinaryBuffer", () => {
  it("detects null byte as binary", () => {
    expect(isBinaryBuffer(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
  });

  it("treats all-printable as non-binary", () => {
    expect(isBinaryBuffer(Buffer.from("hello world"))).toBe(false);
  });

  it("handles empty buffer", () => {
    expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
  });
});

describe("readFileHex", () => {
  it("reads the first 32 bytes of a binary file", async () => {
    const chunk = await readFileHex(path.join(DATA, "binary-a.bin"), 0, 32);
    expect(chunk.totalSize).toBe(256);
    expect(chunk.offset).toBe(0);
    expect(chunk.rows.length).toBe(2); // 32 bytes = 2 rows of 16
  });

  it("first row bytes are 0x00..0x0F", async () => {
    const chunk = await readFileHex(path.join(DATA, "binary-a.bin"), 0, 16);
    expect(chunk.rows[0].bytes).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it("offset is correctly applied", async () => {
    const chunk = await readFileHex(path.join(DATA, "binary-a.bin"), 16, 16);
    expect(chunk.rows[0].offset).toBe(16);
    expect(chunk.rows[0].bytes[0]).toBe(16);
  });

  it("reads beyond EOF returns partial rows", async () => {
    const chunk = await readFileHex(path.join(DATA, "binary-a.bin"), 250, 32);
    // Only 6 bytes remaining (250..255)
    expect(chunk.rows.length).toBe(1);
    expect(chunk.rows[0].bytes.length).toBe(6);
  });

  it("ascii field replaces non-printable with dot", async () => {
    const chunk = await readFileHex(path.join(DATA, "binary-a.bin"), 0, 16);
    // Bytes 0x00-0x0F are not printable
    expect(chunk.rows[0].ascii).toBe("................");
  });

  it("ascii field shows printable chars", async () => {
    const fPath = path.join(DATA, "_ascii-test.bin");
    fs.writeFileSync(fPath, "Hello, World!!!");
    const chunk = await readFileHex(fPath, 0, 15);
    expect(chunk.rows[0].ascii).toBe("Hello, World!!!");
    fs.unlinkSync(fPath);
  });

  it("returns empty rows when offset >= file size", async () => {
    const chunk = await readFileHex(path.join(DATA, "binary-a.bin"), 9999, 32);
    expect(chunk.rows.length).toBe(0);
  });

  it("binary-a and binary-b differ at bytes 100-119", async () => {
    const a = await readFileHex(path.join(DATA, "binary-a.bin"), 96, 32);
    const b = await readFileHex(path.join(DATA, "binary-b.bin"), 96, 32);
    // Row at offset 96: bytes 96-111 (some overlap with changed range 100-119)
    const rowA = a.rows[0].bytes;
    const rowB = b.rows[0].bytes;
    // Bytes at index 4..15 within this row cover offsets 100..111 — should differ
    const diffCount = rowA.filter((byte, i) => byte !== rowB[i]).length;
    expect(diffCount).toBeGreaterThan(0);
  });
});

describe("getPathStat", () => {
  it("stat for an existing file", async () => {
    const stat = await getPathStat(path.join(DATA, "file-a.ts"));
    expect(stat.exists).toBe(true);
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("stat for an existing directory", async () => {
    const stat = await getPathStat(path.join(DATA, "left"));
    expect(stat.exists).toBe(true);
    expect(stat.isDirectory).toBe(true);
    expect(stat.isFile).toBe(false);
  });

  it("stat for a missing path returns exists=false", async () => {
    const stat = await getPathStat(path.join(DATA, "does-not-exist"));
    expect(stat.exists).toBe(false);
    expect(stat.isDirectory).toBe(false);
    expect(stat.isFile).toBe(false);
    expect(stat.size).toBe(0);
  });
});

describe("computeDiff against real data files", () => {
  it("produces diff lines for file-a.ts vs file-b.ts", async () => {
    const left = await readFileAsText(path.join(DATA, "file-a.ts"));
    const right = await readFileAsText(path.join(DATA, "file-b.ts"));
    const diff = computeDiff(left.split("\n"), right.split("\n"));
    expect(diff.length).toBeGreaterThan(0);
    // file-b has more content — there should be added lines
    const added = diff.filter((d) => d.type === "added");
    expect(added.length).toBeGreaterThan(0);
  });

  it("produces diff lines for index.ts left vs right", async () => {
    const left = await readFileAsText(path.join(DATA, "left/index.ts"));
    const right = await readFileAsText(path.join(DATA, "right/index.ts"));
    const diff = computeDiff(left.split("\n"), right.split("\n"));
    const changed = diff.filter((d) => d.type !== "equal");
    expect(changed.length).toBeGreaterThan(0);
  });

  it("config.json left vs right produces all-equal diff", async () => {
    const left = await readFileAsText(path.join(DATA, "left/config.json"));
    const right = await readFileAsText(path.join(DATA, "right/config.json"));
    const diff = computeDiff(left.split("\n"), right.split("\n"));
    expect(diff.every((d) => d.type === "equal")).toBe(true);
  });
});
