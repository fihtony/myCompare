import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectDropType, handleDroppedPaths } from "../renderer/hooks/useDropZone";
import { useSessionStore } from "../renderer/store/session-store";
import { mockElectronAPI } from "./setup";

beforeEach(() => {
  useSessionStore.setState({ sessions: [], activeSessionId: null });
  vi.clearAllMocks();
});

describe("detectDropType", () => {
  it("returns 'folder' when pathStat reports isDirectory=true", async () => {
    mockElectronAPI.pathStat.mockResolvedValue({
      exists: true,
      isDirectory: true,
      isFile: false,
      size: 0,
    });
    const type = await detectDropType(["/some/dir"]);
    expect(type).toBe("folder");
  });

  it("returns 'file' when pathStat reports isDirectory=false", async () => {
    mockElectronAPI.pathStat.mockResolvedValue({
      exists: true,
      isDirectory: false,
      isFile: true,
      size: 1024,
    });
    const type = await detectDropType(["/some/file.ts"]);
    expect(type).toBe("file");
  });

  it("returns 'file' via extension heuristic when electronAPI is unavailable", async () => {
    const original = window.electronAPI;
    // @ts-ignore
    window.electronAPI = undefined;
    const type = await detectDropType(["/some/file.ts"]);
    expect(type).toBe("file");
    // @ts-ignore
    window.electronAPI = original;
  });

  it("returns 'folder' via extension heuristic for no-extension path", async () => {
    const original = window.electronAPI;
    // @ts-ignore
    window.electronAPI = undefined;
    const type = await detectDropType(["/some/dir"]);
    expect(type).toBe("folder");
    // @ts-ignore
    window.electronAPI = original;
  });
});

describe("handleDroppedPaths", () => {
  beforeEach(() => {
    mockElectronAPI.pathStat.mockResolvedValue({
      exists: true,
      isDirectory: true,
      isFile: false,
      size: 0,
    });
  });

  it("creates a folder session when 2 directories are dropped", async () => {
    await handleDroppedPaths(["/dir1", "/dir2"]);
    const s = useSessionStore.getState().sessions;
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe("folder");
  });

  it("creates a file session when 2 files are dropped", async () => {
    mockElectronAPI.pathStat.mockResolvedValue({
      exists: true,
      isDirectory: false,
      isFile: true,
      size: 100,
    });
    await handleDroppedPaths(["/a.ts", "/b.ts"]);
    const s = useSessionStore.getState().sessions;
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe("file");
  });

  it("creates a folder session when 1 directory is dropped", async () => {
    await handleDroppedPaths(["/dir1"]);
    const s = useSessionStore.getState().sessions;
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe("folder");
    expect(s[0].leftPath).toBe("/dir1");
  });

  it("ignores empty path array", async () => {
    await handleDroppedPaths([]);
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  it("uses only the first 2 paths when more than 2 are dropped", async () => {
    await handleDroppedPaths(["/a", "/b", "/c"]);
    const s = useSessionStore.getState().sessions[0];
    expect(s.leftPath).toBe("/a");
    expect(s.rightPath).toBe("/b");
  });
});
