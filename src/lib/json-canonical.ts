// requests.ts (canonicalPayloadHash) と observations.ts (observationId) が共有する canonical JSON 化。
// ハッシュの入力を作るためだけに使うので、キー順序に依存しない出力にすることだけが要件。

/** ハッシュがキー順序に依存しないよう、キーを再帰的にソートする。 */
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
