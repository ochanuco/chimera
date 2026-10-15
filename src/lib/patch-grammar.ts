// 呼び出し側が渡す patch を、chagama がカタログの `patches` に載せた文法で作成時に検査する (docs/generation-request.md「作成時の文法検査」)。
// 文法は chagama のものなので chimera では複製しない: target の class、class ごとの op、op ごとの value / old はすべてカタログから読む。
// 値の制約 (constraints / values / dial word)、part の実在、old の有無は worker が決める。

import { getCatalog } from './catalogs';
import { patchesShapeIssues } from './experiment-rules';
import { ValidationError, validate, type ValidationIssue } from './validate';
import { patchGrammarBlockSchema } from '../schemas/catalogs';

type IssuePath = (string | number)[];

const TEXT_VALUE_KEYS = ['value', 'old'] as const;
/** `patches` の直下にあっても set 型の class ではないキー。 */
const NON_SET_CLASS_KEYS = new Set(['text', 'keys', 'overrides']);
const PART_PLACEHOLDER = '<part>';

export interface PatchGrammar {
  /** patch が持てるキー。 */
  keys: readonly string[];
  /** text 型の op -> その op が取る `value` / `old`。 */
  textOps: ReadonlyMap<string, readonly string[]>;
  textTargets: ReadonlySet<string>;
  /** `prompt.positive.` — これに `.` を含まない part 名が続く target も text 型。 */
  partPrefix: string | null;
  /** set 型 (number / string / loras ...) の target -> 宣言された op。 */
  setOps: ReadonlyMap<string, string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** カタログの `patches` ブロックを文法に直す。`text.ops` と `keys` が無い旧い形式 (`{}` や `{ pose: { op: 'set' } }`) は null。 */
export function parsePatchGrammar(block: unknown): PatchGrammar | null {
  const parsed = validate(patchGrammarBlockSchema, block);
  if (!parsed.ok) return null;
  const { keys, text } = parsed.value;

  const textOps = new Map<string, readonly string[]>();
  for (const [op, opKeys] of Object.entries(text.ops)) {
    textOps.set(op, opKeys.filter((key) => (TEXT_VALUE_KEYS as readonly string[]).includes(key)));
  }
  const partTarget = text.part_target;
  const partPrefix = partTarget?.endsWith(PART_PLACEHOLDER) ? partTarget.slice(0, -PART_PLACEHOLDER.length) : null;

  const setOps = new Map<string, string>();
  for (const [className, entries] of Object.entries(parsed.value)) {
    if (NON_SET_CLASS_KEYS.has(className) || !isPlainObject(entries)) continue;
    for (const [target, spec] of Object.entries(entries)) {
      if (isPlainObject(spec) && typeof spec.op === 'string') setOps.set(target, spec.op);
    }
  }

  return { keys, textOps, textTargets: new Set(text.targets ?? []), partPrefix, setOps };
}

/** recipe_ref のカタログから文法を読む。カタログ・`patches` ブロックが無い、または形が合わないときは null (検査しない)。 */
export async function loadPatchGrammar(db: D1Database, recipeRef: string): Promise<PatchGrammar | null> {
  const catalog = await getCatalog(db, recipeRef);
  return catalog ? parsePatchGrammar(catalog.doc.patches) : null;
}

function isTextTarget(grammar: PatchGrammar, target: string): boolean {
  if (grammar.textTargets.has(target)) return true;
  if (grammar.partPrefix === null || !target.startsWith(grammar.partPrefix)) return false;
  const part = target.slice(grammar.partPrefix.length);
  return part.length > 0 && !part.includes('.');
}

function isEmptyString(value: unknown): boolean {
  return typeof value !== 'string' || value.length === 0;
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function isEmptySetValue(value: unknown): boolean {
  return isAbsent(value) || value === '' || (Array.isArray(value) && value.length === 0);
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

function useOps(ops: readonly string[]): string {
  return ops.length === 1 ? `use ${ops[0]}` : `use one of ${ops.join(', ')}`;
}

function textPatchIssues(grammar: PatchGrammar, patch: Record<string, unknown>, target: string, op: string, at: (field: string) => IssuePath): ValidationIssue[] {
  const takes = grammar.textOps.get(op);
  if (takes === undefined) {
    return [{ path: at('op'), message: `op '${op}' is not valid for ${target}; ${useOps([...grammar.textOps.keys()])}` }];
  }
  const issues: ValidationIssue[] = [];
  for (const key of takes) {
    if (!isEmptyString(patch[key])) continue;
    let message = `must be a non-empty string (op '${op}' takes ${takes.join(' and ')})`;
    // このキーを外した op の組を取る op があれば案内する (空の value の replace に、old だけを取る op、など)。
    const rest = takes.filter((k) => k !== key);
    const alternatives = [...grammar.textOps].filter(([, keys]) => sameKeys(keys, rest)).map(([name]) => name);
    if (alternatives.length > 0) message += `; ops that take no ${key}: ${alternatives.join(', ')}`;
    issues.push({ path: at(key), message });
  }
  for (const key of TEXT_VALUE_KEYS) {
    if (!takes.includes(key) && !isAbsent(patch[key])) {
      issues.push({ path: at(key), message: `op '${op}' does not take ${key}` });
    }
  }
  return issues;
}

/**
 * patches (`[{target, op, reason, value?, old?}]`) の文法違反。path は basePath の下。
 * 封筒 (配列か、target / op / reason が非空文字列か) の違反もここで返す: generate の payload にはそれを見る箇所が無い。
 * どの class にも属さない target は、`patches` ブロックが古い worker のものかもしれないので検査しない。
 */
export function patchGrammarIssues(grammar: PatchGrammar, patches: unknown, basePath: IssuePath): ValidationIssue[] {
  if (patches === undefined || patches === null) return [];
  const issues = patchesShapeIssues(patches, basePath);
  if (!Array.isArray(patches)) return issues;

  const allowedKeys = new Set(grammar.keys);
  patches.forEach((patch, index) => {
    if (!isPlainObject(patch)) return;
    const at = (field: string): IssuePath => [...basePath, index, field];
    for (const key of Object.keys(patch)) {
      if (!allowedKeys.has(key)) {
        issues.push({ path: at(key), message: `unknown patch key; allowed: ${grammar.keys.join(', ')}` });
      }
    }
    const { target, op } = patch;
    if (typeof target !== 'string' || target.length === 0 || typeof op !== 'string' || op.length === 0) return;

    if (isTextTarget(grammar, target)) {
      issues.push(...textPatchIssues(grammar, patch, target, op, at));
      return;
    }
    const declaredOp = grammar.setOps.get(target);
    if (declaredOp === undefined) return;
    if (op !== declaredOp) {
      issues.push({ path: at('op'), message: `op '${op}' is not valid for ${target}; ${useOps([declaredOp])}` });
    } else if (isEmptySetValue(patch.value)) {
      issues.push({ path: at('value'), message: `required for op '${op}'` });
    }
  });
  return issues;
}

function hasPatches(patches: unknown): boolean {
  return !(patches === undefined || patches === null || (Array.isArray(patches) && patches.length === 0));
}

export interface PatchList {
  patches: unknown;
  basePath: IssuePath;
}

/** 複数の patches をまとめて検査し、違反は 1 つの ValidationError に集める。検査する patches が無ければ DB を読まない。 */
export async function assertPatchLists(db: D1Database, recipeRef: string, lists: readonly PatchList[]): Promise<void> {
  const present = lists.filter((list) => hasPatches(list.patches));
  if (present.length === 0) return;
  const grammar = await loadPatchGrammar(db, recipeRef);
  if (grammar === null) return;
  const issues = present.flatMap((list) => patchGrammarIssues(grammar, list.patches, list.basePath));
  if (issues.length > 0) throw new ValidationError(issues);
}

/** 文法が無ければ検査しない。違反があれば ValidationError (REST は 400、MCP は tool error)。 */
export function assertPatchGrammar(db: D1Database, recipeRef: string, patches: unknown, basePath: IssuePath): Promise<void> {
  return assertPatchLists(db, recipeRef, [{ patches, basePath }]);
}

/**
 * kind=generate の payload の、呼び出し側が渡した `generation.patches`。createRequest の `checkPatches` に渡す。
 * REST の POST /requests と MCP create_request だけが渡し、リロールのように元の patches を引き継ぐ経路は渡さない。
 */
export function generatePayloadPatches(kind: string, payload: unknown): PatchList | undefined {
  if (kind !== 'generate' || !isPlainObject(payload) || !isPlainObject(payload.generation)) return undefined;
  return { patches: payload.generation.patches, basePath: ['payload', 'generation', 'patches'] };
}
