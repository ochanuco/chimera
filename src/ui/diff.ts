/** Token-level diff helpers for the Compare page's semantic diff table (consensus-style: every lane's own text is
 * shown, tokens highlighted by how many *other* lanes in the row also have them — no lane is singled out as a "base"). */

export type DiffSeg = { text: string; type: 'same' | 'uniq' | 'partial' };

/** Above this base.length * target.length, the O(n·m) LCS DP is skipped in favor of a coarse whole-value diff. */
const DP_PRODUCT_LIMIT = 200_000;

const TOKEN_RE = /\s+|[A-Za-z0-9_'-]+|./gsu;

/** Splits text into diff tokens: whitespace runs, word runs (ASCII alnum/_/'/-), or single characters (CJK etc). */
export function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

type Op = { type: 'same' | 'del' | 'add'; text: string };

/** Backtraces a standard LCS DP table into a same/del/add op per source token, in target order. */
function lcsOps(base: string[], target: string[]): Op[] {
  const n = base.length;
  const m = target.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = base[i] === target[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === target[j]) {
      ops.push({ type: 'same', text: base[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'del', text: base[i]! });
      i++;
    } else {
      ops.push({ type: 'add', text: target[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: base[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', text: target[j]! });
    j++;
  }
  return ops;
}

/** One boolean per token: true where it's part of the pairwise LCS match against `other`, false where unique to `tokens`.
 * Falls back to a coarse whole-value comparison above DP_PRODUCT_LIMIT (avoid O(n·m) blowup): all true if joined values are equal, else all false. */
export function matchMask(tokens: string[], other: string[]): boolean[] {
  if (tokens.length * other.length > DP_PRODUCT_LIMIT) {
    const same = tokens.join('') === other.join('');
    return tokens.map(() => same);
  }
  return lcsOps(tokens, other)
    .filter((op) => op.type !== 'add')
    .map((op) => op.type === 'same');
}

/** Consensus segments for one lane's tokens: matchCounts[i] is how many other lanes matched that token (0..othersCount) —
 * 'same' if all, 'uniq' if none, else 'partial'. Adjacent same-type tokens merge into one segment. */
export function consensusSegments(tokens: string[], matchCounts: number[], othersCount: number): DiffSeg[] {
  const segs: DiffSeg[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const count = matchCounts[i]!;
    const type: DiffSeg['type'] = count === othersCount ? 'same' : count === 0 ? 'uniq' : 'partial';
    const last = segs[segs.length - 1];
    if (last && last.type === type) {
      last.text += tokens[i]!;
    } else {
      segs.push({ text: tokens[i]!, type });
    }
  }
  return segs;
}
