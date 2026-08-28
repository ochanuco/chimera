/**
 * Token-level diff helpers for the Compare page's semantic diff table
 * (GitHub-style word-diff: additions and deletions highlighted inline).
 */

export type DiffSeg = { text: string; type: 'same' | 'add' | 'del' };

/** Above this base.length * target.length, the O(n·m) LCS DP is skipped in favor of a coarse whole-value diff. */
const DP_PRODUCT_LIMIT = 200_000;

const TOKEN_RE = /\s+|[A-Za-z0-9_'-]+|./gsu;

/** Splits text into diff tokens: whitespace runs, word runs (ASCII alnum/_/'/-), or single characters (CJK etc). */
export function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

type Op = { type: DiffSeg['type']; text: string };

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

/** Within each contiguous non-same run, orders deletions before additions (so replacements read as del-then-add). */
function regroupDelBeforeAdd(ops: Op[]): Op[] {
  const result: Op[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.type === 'same') {
      result.push(ops[i]!);
      i++;
      continue;
    }
    const dels: Op[] = [];
    const adds: Op[] = [];
    while (i < ops.length && ops[i]!.type !== 'same') {
      (ops[i]!.type === 'del' ? dels : adds).push(ops[i]!);
      i++;
    }
    result.push(...dels, ...adds);
  }
  return result;
}

/** Merges adjacent ops of the same type into one segment. */
function mergeOps(ops: Op[]): DiffSeg[] {
  const merged: DiffSeg[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      last.text += op.text;
    } else {
      merged.push({ text: op.text, type: op.type });
    }
  }
  return merged;
}

/**
 * Diffs base tokens against target tokens (target's perspective): tokens only base has are 'del',
 * tokens only target has are 'add', shared tokens are 'same'. Falls back to a coarse whole-value
 * diff when base.length * target.length exceeds DP_PRODUCT_LIMIT, to avoid O(n·m) blowup.
 */
export function diffTokens(base: string[], target: string[]): DiffSeg[] {
  if (base.length * target.length > DP_PRODUCT_LIMIT) {
    const baseJoined = base.join('');
    const targetJoined = target.join('');
    if (baseJoined === targetJoined) return [{ text: targetJoined, type: 'same' }];
    const segs: DiffSeg[] = [];
    if (baseJoined) segs.push({ text: baseJoined, type: 'del' });
    if (targetJoined) segs.push({ text: targetJoined, type: 'add' });
    return segs;
  }
  return mergeOps(regroupDelBeforeAdd(lcsOps(base, target)));
}

/**
 * Diffs base items against target items at item granularity (each list entry is one token), for
 * strengths/defects/list-shaped attributes. Each item stays its own segment (not merged with
 * neighbors) so callers can render one item per line; segments other than the last carry a
 * trailing '\n' separator.
 */
export function diffList(base: string[], target: string[]): DiffSeg[] {
  const ops = regroupDelBeforeAdd(lcsOps(base, target));
  return ops.map((op, idx) => ({
    type: op.type,
    text: idx < ops.length - 1 ? `${op.text}\n` : op.text,
  }));
}
