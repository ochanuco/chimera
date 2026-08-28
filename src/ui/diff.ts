/**
 * Token-level diff helpers for the Compare page's semantic diff table
 * (WinMerge-style per-lane highlighting: each cell shows only its own text,
 * with the parts that differ from the row's base highlighted).
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
 * For a non-base cell: diffs base tokens against this cell's own (target) tokens and returns only
 * the target's own text, with tokens that base lacks marked 'add'. Never emits 'del' — the base's
 * text is never drawn into a non-base cell. Falls back to a coarse whole-value diff when
 * base.length * target.length exceeds DP_PRODUCT_LIMIT, to avoid O(n·m) blowup.
 */
export function addOnlySegments(base: string[], target: string[]): DiffSeg[] {
  if (base.length * target.length > DP_PRODUCT_LIMIT) {
    const baseJoined = base.join('');
    const targetJoined = target.join('');
    if (!targetJoined) return [];
    return [{ text: targetJoined, type: baseJoined === targetJoined ? 'same' : 'add' }];
  }
  return mergeOps(lcsOps(base, target).filter((op) => op.type !== 'del'));
}

/**
 * For the base cell: returns one boolean per base token, true where that token has no counterpart
 * in target (i.e. it would render as 'del' against target). Same fallback threshold as
 * addOnlySegments.
 */
export function delMask(base: string[], target: string[]): boolean[] {
  if (base.length * target.length > DP_PRODUCT_LIMIT) {
    const differs = base.join('') !== target.join('');
    return base.map(() => differs);
  }
  return lcsOps(base, target)
    .filter((op) => op.type !== 'add')
    .map((op) => op.type === 'del');
}

/** Builds base-cell segments from a delMask (typically the OR of delMask against every other real cell in the row). */
export function maskToSegments(tokens: string[], mask: boolean[]): DiffSeg[] {
  const segs: DiffSeg[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const type: DiffSeg['type'] = mask[i] ? 'del' : 'same';
    const last = segs[segs.length - 1];
    if (last && last.type === type) {
      last.text += tokens[i]!;
    } else {
      segs.push({ text: tokens[i]!, type });
    }
  }
  return segs;
}
