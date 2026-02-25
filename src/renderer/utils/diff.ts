/**
 * Line-level diff using the Longest Common Subsequence (LCS) algorithm.
 * Exported as a pure function so it can be unit tested independently.
 */

/** A run of characters within a line, flagged as changed or unchanged. */
export interface DiffSpan {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: "equal" | "added" | "removed" | "modified" | "whitespace";
  leftLineNo?: number;
  rightLineNo?: number;
  leftText: string;
  rightText: string;
  /** Character-level diff spans for the left side (only set for "modified"/"whitespace" lines). */
  leftSpans?: DiffSpan[];
  /** Character-level diff spans for the right side (only set for "modified"/"whitespace" lines). */
  rightSpans?: DiffSpan[];
}

/**
 * Compute character-level diff spans between two strings using LCS.
 * Returns arrays of {text, changed} spans for each side.
 * Falls back to whole-line changed if strings are too long (avoids O(n²) cost).
 */
export function computeCharDiff(a: string, b: string): { leftSpans: DiffSpan[]; rightSpans: DiffSpan[] } {
  const m = a.length;
  const n = b.length;

  // For very long lines, mark the whole line as changed to stay performant
  if (m * n > 40000) {
    return {
      leftSpans: a ? [{ text: a, changed: true }] : [],
      rightSpans: b ? [{ text: b, changed: true }] : [],
    };
  }

  // LCS DP on characters
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to tag each character as changed or not
  type TaggedChar = { ch: string; changed: boolean };
  const leftChars: TaggedChar[] = [];
  const rightChars: TaggedChar[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      leftChars.unshift({ ch: a[i - 1], changed: false });
      rightChars.unshift({ ch: b[j - 1], changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rightChars.unshift({ ch: b[j - 1], changed: true });
      j--;
    } else {
      leftChars.unshift({ ch: a[i - 1], changed: true });
      i--;
    }
  }

  // Merge consecutive same-flag characters into spans
  const toSpans = (chars: TaggedChar[]): DiffSpan[] => {
    const spans: DiffSpan[] = [];
    for (const { ch, changed } of chars) {
      if (spans.length > 0 && spans[spans.length - 1].changed === changed) {
        spans[spans.length - 1].text += ch;
      } else {
        spans.push({ text: ch, changed });
      }
    }
    return spans;
  };

  return { leftSpans: toSpans(leftChars), rightSpans: toSpans(rightChars) };
}

export function computeDiff(leftLines: string[], rightLines: string[]): DiffLine[] {
  const m = leftLines.length;
  const n = rightLines.length;

  // Build LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = leftLines[i - 1] === rightLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to build raw diff list (only equal/added/removed)
  const raw: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      raw.unshift({
        type: "equal",
        leftLineNo: i,
        rightLineNo: j,
        leftText: leftLines[i - 1],
        rightText: rightLines[j - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.unshift({ type: "added", rightLineNo: j, leftText: "", rightText: rightLines[j - 1] });
      j--;
    } else {
      raw.unshift({ type: "removed", leftLineNo: i, leftText: leftLines[i - 1], rightText: "" });
      i--;
    }
  }

  // Post-process: pair adjacent removed+added into a "modified" or "whitespace" line with char-level spans
  const ops: DiffLine[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    const next = raw[k + 1];
    if (cur.type === "removed" && next?.type === "added") {
      const { leftSpans, rightSpans } = computeCharDiff(cur.leftText, next.rightText);
      // If collapsing whitespace makes them equal, mark as whitespace-only difference
      const isWhitespaceOnly = cur.leftText.replace(/\s/g, "") === next.rightText.replace(/\s/g, "");
      ops.push({
        type: isWhitespaceOnly ? "whitespace" : "modified",
        leftLineNo: cur.leftLineNo,
        rightLineNo: next.rightLineNo,
        leftText: cur.leftText,
        rightText: next.rightText,
        leftSpans,
        rightSpans,
      });
      k++; // consume the "added" line too
    } else {
      ops.push(cur);
    }
  }

  return ops;
}

/** Infer a highlight.js language tag from a file path / name. */
export function detectLanguage(filePath: string): string {
  // Check for known extension-less filenames first
  const basename = filePath.split("/").pop() ?? "";
  const basenameLC = basename.toLowerCase();
  if (basenameLC === "dockerfile") return "dockerfile";
  if (basenameLC === "makefile") return "makefile";

  const dotIdx = basename.lastIndexOf(".");
  const ext = dotIdx >= 0 ? basename.slice(dotIdx + 1).toLowerCase() : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    html: "html",
    htm: "html",
    xml: "xml",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    graphql: "graphql",
    lua: "lua",
    r: "r",
  };
  return map[ext] ?? "plaintext";
}

/** Format a byte offset as an 8-digit hex string, e.g. 000002A0 */
export function formatHexOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, "0");
}

/** Format a byte value as two uppercase hex digits */
export function formatByte(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, "0");
}
