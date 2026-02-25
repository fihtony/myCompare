// @vitest-environment node
/**
 * Integration test: folder comparison engine
 * Uses real files in data/left vs data/right.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { runFolderCompare } from "../../main/core/compare-engine";
import { CompareState } from "../../shared/types";

const DATA = path.resolve(__dirname, "../../../data");
const LEFT = path.join(DATA, "left");
const RIGHT = path.join(DATA, "right");

describe("runFolderCompare — data/left vs data/right", () => {
  it("returns a result with items and stats", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    expect(result.leftPath).toBe(LEFT);
    expect(result.rightPath).toBe(RIGHT);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.stats.total).toBeGreaterThan(0);
  });

  it("detects identical files (config.json is equal)", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const config = result.items.find((i) => i.name === "config.json" && i.type === "file");
    expect(config).toBeDefined();
    expect(config!.state).toBe(CompareState.EQUAL);
  });

  it("detects modified files (index.ts differs)", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const index = result.items.find((i) => i.name === "index.ts" && i.type === "file");
    expect(index).toBeDefined();
    expect(index!.state).toBe(CompareState.MODIFIED);
  });

  it("detects left-only files (legacy.ts only in left)", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const legacy = result.items.find((i) => i.name === "legacy.ts");
    expect(legacy).toBeDefined();
    expect(legacy!.state).toBe(CompareState.ONLY_LEFT);
  });

  it("detects right-only files (helpers.ts only in right)", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const helpers = result.items.find((i) => i.name === "helpers.ts");
    expect(helpers).toBeDefined();
    expect(helpers!.state).toBe(CompareState.ONLY_RIGHT);
  });

  it("detects sub/utils.ts as modified", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const utils = result.items.find((i) => i.name === "utils.ts" && i.type === "file");
    expect(utils).toBeDefined();
    expect(utils!.state).toBe(CompareState.MODIFIED);
  });

  it("detects sub/removed.ts as only-left", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const removed = result.items.find((i) => i.name === "removed.ts");
    expect(removed).toBeDefined();
    expect(removed!.state).toBe(CompareState.ONLY_LEFT);
  });

  it("detects sub/added.ts as only-right", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const added = result.items.find((i) => i.name === "added.ts");
    expect(added).toBeDefined();
    expect(added!.state).toBe(CompareState.ONLY_RIGHT);
  });

  it("stats are consistent with total", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const { equal, modified, onlyLeft, onlyRight, errors, total } = result.stats;
    expect(equal + modified + onlyLeft + onlyRight + errors).toBe(total);
  });

  it("stats.modified >= 2 (index.ts and sub/utils.ts)", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    expect(result.stats.modified).toBeGreaterThanOrEqual(2);
  });

  it("stats.onlyLeft >= 2 (legacy.ts and sub/removed.ts)", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    expect(result.stats.onlyLeft).toBeGreaterThanOrEqual(2);
  });

  it("stats.onlyRight >= 2 (helpers.ts and sub/added.ts)", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    expect(result.stats.onlyRight).toBeGreaterThanOrEqual(2);
  });

  it("exclude patterns filter out files", () => {
    const result = runFolderCompare(LEFT, RIGHT, ["*.ts"]);
    // With *.ts excluded, all .ts files should be gone
    const tsFiles = result.items.filter((i) => i.type === "file" && i.name.endsWith(".ts"));
    expect(tsFiles.length).toBe(0);
  });

  it("exclude patterns leave non-excluded files", () => {
    const result = runFolderCompare(LEFT, RIGHT, ["*.ts"]);
    const jsonFiles = result.items.filter((i) => i.type === "file" && i.name.endsWith(".json"));
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  it("same folder compare returns all equal", () => {
    const result = runFolderCompare(LEFT, LEFT, []);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.onlyLeft).toBe(0);
    expect(result.stats.onlyRight).toBe(0);
    expect(result.stats.equal).toBe(result.stats.total);
  });

  it("throws when a path does not exist", () => {
    expect(() => runFolderCompare("/nonexistent/left", "/nonexistent/right", [])).toThrow();
  });

  it("items have leftSize set for modified files", () => {
    const result = runFolderCompare(LEFT, RIGHT, []);
    const modified = result.items.filter((i) => i.state === CompareState.MODIFIED && i.type === "file");
    for (const item of modified) {
      expect(item.leftSize).toBeGreaterThan(0);
      expect(item.rightSize).toBeGreaterThan(0);
    }
  });
});
