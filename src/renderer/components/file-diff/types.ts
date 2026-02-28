/**
 * Shared types for the file-diff sub-module.
 */

/** Which cell is currently open for inline editing. */
export interface ActiveEditCell {
  idx: number;
  side: "left" | "right";
}

/** Internal ref tracking the user's live keystrokes in an active contentEditable cell. */
export interface EditingCellInfo {
  idx: number;
  side: "left" | "right";
  /** Current live text content (updated on every onInput). */
  text: string;
  /** Text at the moment the cell was focused — used to detect uncommitted changes on blur. */
  originalText: string;
}
