import { useEffect, useCallback, useState } from "react";
import { useSessionStore } from "../store/session-store";
import { log } from "../../shared/logger";

/** Tracks the global drag-over state so components can show a drop overlay. */
export let isDraggingFiles = false;
const dragListeners = new Set<(v: boolean) => void>();

export function useDraggingState(): boolean {
  const [dragging, setDragging] = useState(isDraggingFiles);
  useEffect(() => {
    dragListeners.add(setDragging);
    return () => {
      dragListeners.delete(setDragging);
    };
  }, []);
  return dragging;
}

function setDragging(v: boolean) {
  isDraggingFiles = v;
  dragListeners.forEach((fn) => fn(v));
}

/**
 * Detect whether dropped paths are files or directories.
 * Uses pathStat IPC when in Electron; falls back to extension heuristic elsewhere.
 */
export async function detectDropType(paths: string[]): Promise<"folder" | "file"> {
  if (paths.length === 0) return "folder";
  if (typeof window !== "undefined" && window.electronAPI?.pathStat) {
    const stat = await window.electronAPI.pathStat(paths[0]);
    const type = stat.isDirectory ? "folder" : "file";
    log("Drop", `Path type: ${paths[0]} → ${type}`);
    return type;
  }
  // Heuristic: if the first path has a file extension assume it's a file
  const type = /\.[^/\\]+$/.test(paths[0]) ? "file" : "folder";
  log("Drop", `Path type (heuristic): ${paths[0]} → ${type}`);
  return type;
}

/** Create the appropriate session type for the dropped paths. */
export async function handleDroppedPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    log("Drop", "No paths to handle");
    return;
  }
  log("Drop", `User action: Dropped ${paths.length} path(s): ${paths.map((p) => p.split("/").pop()).join(", ")}`);
  const store = useSessionStore.getState();
  const kind = await detectDropType(paths);
  log("Drop", `Detected type: ${kind} (paths: ${paths.join(", ")})`);

  try {
    if (paths.length >= 2) {
      if (kind === "folder") {
        const id = store.createFolderSession(paths[0], paths[1]);
        log("Drop", `✓ Created folder compare session: ${id}`);
        log("Drop", `  Left: ${paths[0]}`);
        log("Drop", `  Right: ${paths[1]}`);
      } else {
        const id = store.createFileSession(paths[0], paths[1]);
        log("Drop", `✓ Created file compare session: ${id}`);
        log("Drop", `  Left: ${paths[0]}`);
        log("Drop", `  Right: ${paths[1]}`);
      }
    } else {
      if (kind === "folder") {
        const id = store.createFolderSession(paths[0], "");
        log("Drop", `✓ Created folder session (1 path): ${id}`);
        log("Drop", `  Path: ${paths[0]}`);
      } else {
        const id = store.createFileSession(paths[0], "");
        log("Drop", `✓ Created file session (1 path): ${id}`);
        log("Drop", `  Path: ${paths[0]}`);
      }
    }
  } catch (err: any) {
    log("Drop", `✗ Error creating session from dropped paths: ${err.message}`);
  }
}

/**
 * Hook that wires up OS-level drag-and-drop for the whole app window.
 * Handles both HTML5 dataTransfer.files drops (Electron renderer)
 * and IPC-forwarded drops from the main process.
 */
export function useDropZone(): void {
  log("Drop", "[useDropZone] Hook initialized");
  const onDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    log("Drop", "[onDrop] HTML5 drop event triggered");

    const files = e.dataTransfer?.files;
    log("Drop", `[onDrop] files count: ${files ? files.length : "null"}`);
    if (!files || files.length === 0) {
      log("Drop", "[onDrop] No files in dataTransfer, returning");
      return;
    }

    // Electron exposes file.path on the File objects from OS drops
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const p = (files[i] as any).path as string | undefined;
      log("Drop", `[onDrop] file[${i}].path = ${p ? p : "(undefined)"}`);
      if (p) paths.push(p);
    }
    if (paths.length === 0) {
      log("Drop", "[onDrop] No valid paths extracted from files, returning");
      return;
    }
    log("Drop", `[onDrop] Detected HTML5 drop with ${paths.length} file(s): ${paths.join(", ")}`);
    await handleDroppedPaths(paths);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    const hasFiles = types.includes("Files");
    log("Drop", `[onDragOver] dataTransfer.types: ${types.join(", ")} | hasFiles=${hasFiles}`);
    if (hasFiles) {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if ((e as any).relatedTarget == null) {
      setDragging(false);
    }
  }, []);

  useEffect(() => {
    log("Drop", "[useDropZone] Setting up drag-and-drop listeners...");
    document.addEventListener("dragover", onDragOver as EventListener);
    log("Drop", "[useDropZone] dragover listener attached");
    document.addEventListener("dragleave", onDragLeave as EventListener);
    log("Drop", "[useDropZone] dragleave listener attached");
    document.addEventListener("drop", onDrop as EventListener);
    log("Drop", "[useDropZone] drop listener attached");

    // IPC-forwarded drops from main process
    if (typeof window !== "undefined" && window.electronAPI?.onDropFiles) {
      log("Drop", "[useDropZone] electronAPI.onDropFiles available, wiring listener...");
      window.electronAPI.onDropFiles((paths: string[]) => {
        log("Drop", `[IPC] Received ${paths.length} IPC drop path(s) from main: ${paths.join(", ")}`);
        handleDroppedPaths(paths);
      });
      log("Drop", "[useDropZone] IPC drop listener wired successfully");
    } else {
      log("Drop", "[useDropZone] WARNING: window.electronAPI.onDropFiles is NOT available");
    }

    return () => {
      document.removeEventListener("dragover", onDragOver as EventListener);
      document.removeEventListener("dragleave", onDragLeave as EventListener);
      document.removeEventListener("drop", onDrop as EventListener);
    };
  }, [onDragOver, onDragLeave, onDrop]);
}
