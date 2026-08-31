// ExperimentRun の overrides / evaluation / decision は typed schema を持たない
// JSON blob（docs/domain-model.md 参照）。ここではその保存形と、Run 間で
// 「前回から何を変えたか」を出すための差分だけを扱う。

export type JsonObject = Record<string, unknown>;

/** Parses a stored JSON column into an object. NULL や壊れた JSON は空オブジェクト扱い。 */
export function parseJsonObject(raw: string | null | undefined): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Same as parseJsonObject but keeps "未設定" (NULL) distinct from "空オブジェクト". */
export function parseJsonObjectOrNull(raw: string | null | undefined): JsonObject | null {
  if (raw === null || raw === undefined) return null;
  return parseJsonObject(raw);
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `.` はパス区切りに使うので、キー自身に含まれる `\` と `.` はエスケープしてから
 * join する。これがないと `{"a.b":1}` と `{"a":{"b":2}}` が同じ `a.b` に潰れて
 * Map 上で衝突する。表示用の文字列なので JSON Pointer 等には寄せず読みやすさを保つ。
 */
function escapeKeySegment(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
}

/**
 * Flattens nested objects into `a.b.c` -> leaf. 配列は葉として扱う（要素単位の
 * 差分は出さず、配列まるごとを1つの変更として見せる）。空オブジェクトも葉。
 */
function flatten(value: JsonObject, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  for (const [key, child] of Object.entries(value)) {
    const segment = escapeKeySegment(key);
    const path = prefix ? `${prefix}.${segment}` : segment;
    if (isPlainObject(child) && Object.keys(child).length > 0) {
      flatten(child, path, out);
    } else {
      out.set(path, child);
    }
  }
  return out;
}

export type OverrideDiffKind = 'added' | 'removed' | 'changed';

export interface OverrideDiffEntry {
  path: string;
  kind: OverrideDiffKind;
  /** Rendered value, or null when the path is absent on that side. */
  before: string | null;
  after: string | null;
}

/** Human-readable rendering of a leaf value; プリミティブの配列は `, ` 連結で読ませる。 */
export function formatOverrideValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const primitivesOnly = value.every((item) => item === null || typeof item !== 'object');
    return primitivesOnly ? value.map(formatOverrideValue).join(', ') : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** Leaf-path diff of two overrides objects, sorted by path. Equal leaves are omitted. */
export function diffOverrides(base: JsonObject, next: JsonObject): OverrideDiffEntry[] {
  const baseLeaves = flatten(base);
  const nextLeaves = flatten(next);
  const paths = Array.from(new Set([...baseLeaves.keys(), ...nextLeaves.keys()])).sort();

  const entries: OverrideDiffEntry[] = [];
  for (const path of paths) {
    const hasBase = baseLeaves.has(path);
    const hasNext = nextLeaves.has(path);
    const before = baseLeaves.get(path);
    const after = nextLeaves.get(path);
    if (hasBase && hasNext) {
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      entries.push({ path, kind: 'changed', before: formatOverrideValue(before), after: formatOverrideValue(after) });
    } else if (hasNext) {
      entries.push({ path, kind: 'added', before: null, after: formatOverrideValue(after) });
    } else {
      entries.push({ path, kind: 'removed', before: formatOverrideValue(before), after: null });
    }
  }
  return entries;
}
