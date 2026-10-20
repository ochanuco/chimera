// Experiment / Run の入力にかかる規則。スキーマ宣言から呼ばれるので schemas にも検証ライブラリにも依存しない。

import { prefixIssues, type ValidationIssue } from './validate';

/** create_experiment の parameters と seeds を、Experiment に保存する base_parameters にまとめる。 */
export function mergedBaseParameters(input: { parameters?: Record<string, unknown>; seeds?: number[] }): Record<string, unknown> {
  return { ...(input.parameters ?? {}), ...(input.seeds ? { seeds: input.seeds } : {}) };
}

type IssuePath = (string | number)[];

export function patchesShapeIssues(patches: unknown, basePath: IssuePath): ValidationIssue[] {
  if (!Array.isArray(patches)) {
    return [{ message: 'must be an array of patch objects, e.g. [{ target, op, reason, value? }]', path: basePath }];
  }
  const issues: ValidationIssue[] = [];
  patches.forEach((patch, i) => {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      issues.push({ message: 'each patch must be an object with target, op and reason', path: [...basePath, i] });
      return;
    }
    for (const field of ['target', 'op', 'reason'] as const) {
      const fieldValue = (patch as Record<string, unknown>)[field];
      if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
        issues.push({ message: 'must be a non-empty string', path: [...basePath, i, field] });
      }
    }
  });
  return issues;
}

const OVERRIDE_KEYS = ['patches', 'parameters', 'seeds'];

export function overridesIssues(value: Record<string, unknown>): ValidationIssue[] {
  const unexpected = Object.keys(value).filter((k) => !OVERRIDE_KEYS.includes(k));
  if (unexpected.length > 0) {
    return [
      {
        message:
          `must be {} or {"patches": [...]}; unexpected key(s): ${unexpected.join(', ')}. ` +
          "Generation parameters (pose, costume, count, ...) belong to the Experiment's base_parameters, not to a Run's overrides.",
        path: [],
      },
    ];
  }
  const issues: ValidationIssue[] = [];
  if ('patches' in value) issues.push(...patchesShapeIssues(value.patches, ['patches']));
  if ('parameters' in value) {
    const parameters = value.parameters;
    const isObject = typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters);
    const keys = isObject ? Object.keys(parameters as object) : [];
    const pose = isObject ? (parameters as Record<string, unknown>).pose : undefined;
    if (!isObject || keys.length !== 1 || typeof pose !== 'string' || pose.length === 0) {
      issues.push({ message: 'must be {"pose": "<pose name>"}; pose is the only parameter a Run may override', path: ['parameters'] });
    }
  }
  if ('seeds' in value) {
    const seeds = value.seeds;
    if (!isSeedList(seeds) || seeds.length !== 1) {
      issues.push({ message: 'must be an array of exactly one non-negative integer', path: ['seeds'] });
    }
  }
  return issues;
}

/** Run の overrides が持つ pose (pose sweep の Run)。無ければ null。 */
export function runOverridePose(overrides: Record<string, unknown>): string | null {
  const parameters = overrides.parameters;
  const pose = typeof parameters === 'object' && parameters !== null ? (parameters as { pose?: unknown }).pose : undefined;
  return typeof pose === 'string' && pose.length > 0 ? pose : null;
}

/** seeds は 1〜16 個の非負整数。 */
function isSeedList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 16 &&
    value.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
  );
}

export function baseParametersIssues(value: Record<string, unknown>): ValidationIssue[] {
  if (!('seeds' in value)) return [];
  const seeds = value.seeds;
  if (!isSeedList(seeds)) {
    return [{ message: 'must be an array of 1-16 non-negative integers', path: ['seeds'] }];
  }
  if ('count' in value && value.count !== seeds.length) {
    return [
      {
        message: `count (${String(value.count)}) must equal seeds length (${seeds.length}); omit count when seeds is given`,
        path: ['count'],
      },
    ];
  }
  return [];
}

/** create_experiment: arm の label は呼び出し内で一意、parameters と seeds をまとめた base_parameters は REST と同じ規則を通す。 */
export function createExperimentInputIssues(value: {
  arms: { label: string }[];
  parameters?: Record<string, unknown>;
  seeds?: number[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  value.arms.forEach((arm, i) => {
    if (seen.has(arm.label)) {
      issues.push({ message: `duplicate arm label '${arm.label}'`, path: ['arms', i, 'label'] });
    }
    seen.add(arm.label);
  });
  issues.push(...prefixIssues(['parameters'], baseParametersIssues(mergedBaseParameters(value))));
  return issues;
}
