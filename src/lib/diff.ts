/** Line diff between two versions of a text file, for the Files view. */

export type DiffLine = { type: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number };
export type DiffHunk = { lines: DiffLine[]; skippedBefore: number };

/** Above this many line pairs the table would be too big; the caller says the files are too large to compare. */
const MAX_CELLS = 4_000_000;

export function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  // Same start and end are common between versions: trim them before the quadratic part.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_CELLS) return null;

  // Longest common subsequence table, filled from the end.
  const n = midA.length;
  const m = midB.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (let k = 0; k < start; k++) out.push({ type: "same", text: a[k], oldNo: oldNo++, newNo: newNo++ });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      out.push({ type: "same", text: midA[i++], oldNo: oldNo++, newNo: newNo++ });
      j++;
    } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // On a tie the removed line comes first, as diffs usually show it.
      out.push({ type: "del", text: midA[i++], oldNo: oldNo++ });
    } else {
      out.push({ type: "add", text: midB[j++], newNo: newNo++ });
    }
  }
  for (let k = endA; k < a.length; k++) out.push({ type: "same", text: a[k], oldNo: oldNo++, newNo: newNo++ });
  return out;
}

/** Keeps `context` unchanged lines around each change and folds the rest. */
export function toHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.type === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const hunks: DiffHunk[] = [];
  let skipped = 0;
  let current: DiffHunk | null = null;
  lines.forEach((l, idx) => {
    if (!keep[idx]) {
      skipped++;
      current = null;
      return;
    }
    if (!current) {
      current = { lines: [], skippedBefore: skipped };
      hunks.push(current);
      skipped = 0;
    }
    current.lines.push(l);
  });
  return hunks;
}

function splitLines(s: string): string[] {
  if (!s) return [];
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
