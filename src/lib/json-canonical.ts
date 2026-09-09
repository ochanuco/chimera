// requests.ts (canonicalPayloadHash) と observations.ts (observationId) が共有する
// canonical JSON 化。両者ともハッシュの入力を作るためだけに使うので、キー順序に
// 依存しない出力にすることだけが要件。

/** キーを再帰的にソートしてから stringify する。ハッシュがキー順序に依存しないようにする。 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries) out[key] = sortKeysDeep(child);
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
