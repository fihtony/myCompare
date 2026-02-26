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

  // For large files: use the fast O((m+n) log n) greedy algorithm to stay memory-safe.
  // Int32Array((m+1)*(n+1)) for m=n=4000 ≈ 64 MB — acceptable, but beyond that we switch.
  if (m * n > MAX_LCS_CELLS) {
    return computeDiffLarge(leftLines, rightLines);
  }

  // Small files: full O(m×n) LCS using a flat Int32Array (much lower GC pressure
  // than a jagged number[][] of the same size).
  const w = n + 1; // row stride
  const dp = new Int32Array((m + 1) * w);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i * w + j] =
        leftLines[i - 1] === rightLines[j - 1] ? dp[(i - 1) * w + (j - 1)] + 1 : Math.max(dp[(i - 1) * w + j], dp[i * w + (j - 1)]);
    }
  }

  // Backtrack to build raw diff list (push then reverse — avoids O(n²) from unshift).
  const raw: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      raw.push({
        type: "equal",
        leftLineNo: i,
        rightLineNo: j,
        leftText: leftLines[i - 1],
        rightText: rightLines[j - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * w + (j - 1)] >= dp[(i - 1) * w + j])) {
      raw.push({ type: "added", rightLineNo: j, leftText: "", rightText: rightLines[j - 1] });
      j--;
    } else {
      raw.push({ type: "removed", leftLineNo: i, leftText: leftLines[i - 1], rightText: "" });
      i--;
    }
  }
  raw.reverse();

  return postProcessRaw(raw);
}

/** Maximum LCS table cells before switching to the fast greedy algorithm. */
const MAX_LCS_CELLS = 16_000_000; // Int32Array for m=n=4000 ≈ 64 MB

/** Binary search: first index where arr[i] > val. Requires sorted arr. */
function upperBound(arr: number[], val: number): number {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= val) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Fast line diff for large files: hash-based greedy monotone matching.
 * O((m+n) log n) time and O(m+n) space — never builds an O(m×n) DP table.
 *
 * Quality: finds a good diff for ordered data (CSV, logs) where lines are mostly
 * sequential. May not always find the minimum edit distance for highly shuffled data.
 */
function computeDiffLarge(leftLines: string[], rightLines: string[]): DiffLine[] {
  // Map each right-file line content → sorted list of right-side indices.
  const rightPos = new Map<string, number[]>();
  for (let j = 0; j < rightLines.length; j++) {
    const t = rightLines[j];
    let arr = rightPos.get(t);
    if (!arr) {
      arr = [];
      rightPos.set(t, arr);
    }
    arr.push(j);
  }

  // Greedy monotone matching: for each left[i], pick the smallest j > lastJ
  // where right[j] === left[i]. This produces a valid (non-crossing) matching.
  const matches: [number, number][] = [];
  let lastJ = -1;
  for (let i = 0; i < leftLines.length; i++) {
    const positions = rightPos.get(leftLines[i]);
    if (positions) {
      const pos = upperBound(positions, lastJ);
      if (pos < positions.length) {
        matches.push([i, positions[pos]]);
        lastJ = positions[pos];
      }
    }
  }

  // Build raw diff list from matched pairs.
  const raw: DiffLine[] = [];
  let li = 0,
    rj = 0;
  for (let mi = 0; mi <= matches.length; mi++) {
    const [matchI, matchJ] = mi < matches.length ? matches[mi] : [leftLines.length, rightLines.length];
    while (li < matchI) {
      raw.push({ type: "removed", leftLineNo: li + 1, leftText: leftLines[li], rightText: "" });
      li++;
    }
    while (rj < matchJ) {
      raw.push({ type: "added", rightLineNo: rj + 1, leftText: "", rightText: rightLines[rj] });
      rj++;
    }
    if (mi < matches.length) {
      raw.push({
        type: "equal",
        leftLineNo: li + 1,
        rightLineNo: rj + 1,
        leftText: leftLines[li],
        rightText: rightLines[rj],
      });
      li++;
      rj++;
    }
  }

  return postProcessRaw(raw);
}

/**
 * Post-process a raw equal/added/removed list:
 * pairs adjacent removed+added rows into "modified" (with char-level spans) or "whitespace".
 */
function postProcessRaw(raw: DiffLine[]): DiffLine[] {
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
