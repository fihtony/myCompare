/**
 * Pure helper utilities shared across the file-diff sub-module.
 */
import hljs from "highlight.js";
import type { DiffLine } from "../../utils/diff";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

export function highlightLine(text: string, lang: string): string {
  if (!text || lang === "plaintext") return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

/** Reconstruct left file text from current diffLines (skips "added"-only rows). */
export function reconstructLeft(lines: DiffLine[]): string {
  return lines
    .filter((d) => d.type !== "added")
    .map((d) => d.leftText)
    .join("\n");
}

/** Reconstruct right file text from current diffLines (skips "removed"-only rows). */
export function reconstructRight(lines: DiffLine[]): string {
  return lines
    .filter((d) => d.type !== "removed")
    .map((d) => d.rightText)
    .join("\n");
}
